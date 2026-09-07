// 本文件是 CLI 仓 tests/e2e 的 Router 测试驱动 overlay。
// 只复制进隔离的临时 Router clone，不得改 Router 原 checkout，也不得提交到 Router。
// 挂上真实 HTTP + MCP adapter 与 toolrouter.Service；仅用本地 fixture 替身 AIsaServices。
package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"github.com/aisa-one/aisa-tool-router/internal/aisa/services"
	apihttp "github.com/aisa-one/aisa-tool-router/internal/api/http"
	apimcp "github.com/aisa-one/aisa-tool-router/internal/api/mcp"
	"github.com/aisa-one/aisa-tool-router/internal/bundle"
	"github.com/aisa-one/aisa-tool-router/internal/catalog/model"
	"github.com/aisa-one/aisa-tool-router/internal/search/ports"
	"github.com/aisa-one/aisa-tool-router/internal/search/retrieval"
	"github.com/aisa-one/aisa-tool-router/internal/toolrouter"
)

const (
	callerKey = "caller-key"
	buildID   = "build_test"
)

type captured struct {
	Method   string `json:"method"`
	Path     string `json:"path"`
	Query    string `json:"query"`
	Auth     string `json:"auth"`
	CostMode string `json:"cost_mode"`
	Body     string `json:"body"`
}

type dispatchState struct {
	Quotes   []captured `json:"quotes"`
	Executes []captured `json:"executes"`
}

type stub struct {
	mu    sync.Mutex
	state dispatchState
}

func (s *stub) snapshot() dispatchState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return dispatchState{
		Quotes:   append([]captured(nil), s.state.Quotes...),
		Executes: append([]captured(nil), s.state.Executes...),
	}
}

func (s *stub) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = dispatchState{}
}

func (s *stub) record(request *http.Request) captured {
	body, _ := io.ReadAll(request.Body)
	item := captured{
		Method:   request.Method,
		Path:     request.URL.Path,
		Query:    request.URL.RawQuery,
		Auth:     request.Header.Get("Authorization"),
		CostMode: request.Header.Get("X-AISA-Cost-Mode"),
		Body:     strings.TrimSpace(string(body)),
	}
	s.mu.Lock()
	if item.CostMode == "quote" {
		s.state.Quotes = append(s.state.Quotes, item)
	} else {
		s.state.Executes = append(s.state.Executes, item)
	}
	s.mu.Unlock()
	return item
}

func exactQuoteBody() string {
	return `{"object":"cost_estimate","currency":"USD","estimate_kind":"exact","estimated_cost_micros_usd":9007199254740993,"max_cost_micros_usd":9007199254740993,"may_exceed_estimate":false,"estimated_at":"2026-09-06T00:00:00Z","future_safe_field":"keep"}`
}

func startUpstream(upstream *stub) string {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/credits/balance", func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+callerKey {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{}`))
	})
	mux.HandleFunc("/info/apis/financial-datasets", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"api":{"id":"financial-datasets","endpoint_groups":[{"endpoints":[{"path":"/apis/v1/financial/facts"},{"path":"/apis/v1/financial/notes"}]}]}}`))
	})
	mux.HandleFunc("/info/apis/financial-datasets/health", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"api":{"id":"financial-datasets","status":"healthy","endpoints":[{"path":"/apis/v1/financial/facts","status":"healthy"},{"path":"/apis/v1/financial/notes","status":"healthy"}]}}`))
	})
	mux.HandleFunc("/apis/v1/financial/facts", func(writer http.ResponseWriter, request *http.Request) {
		item := upstream.record(request)
		ticker := request.URL.Query().Get("ticker")
		if item.CostMode == "quote" {
			if ticker == "FAIL" {
				writer.WriteHeader(http.StatusBadRequest)
				_, _ = writer.Write([]byte(`{"error":{"code":"cost_quote_unsupported","message":"Cost quoting is not supported for this operation."}}`))
				return
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(exactQuoteBody()))
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("X-AISA-Customer-Cost-Micros-USD", "96000")
		_, _ = writer.Write([]byte(`{"ok":true,"ticker":"` + ticker + `"}`))
	})
	mux.HandleFunc("/apis/v1/financial/notes", func(writer http.ResponseWriter, request *http.Request) {
		item := upstream.record(request)
		if item.CostMode == "quote" {
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(exactQuoteBody()))
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("X-AISA-Customer-Cost-Micros-USD", "96000")
		_, _ = writer.Write([]byte(`{"ok":true}`))
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Handler: mux}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			log.Fatal(serveErr)
		}
	}()
	return "http://" + listener.Addr().String()
}

type searchBackend struct{ id string }

func (b searchBackend) BuildID() string { return b.id }
func (searchBackend) Close() error      { return nil }
func (b searchBackend) Search(_ context.Context, _ ports.Query) (ports.Result, error) {
	return ports.Result{BuildID: b.id, Hits: []ports.Hit{{Ref: "getFacts", Kind: "endpoint", Score: 0.9, MatchKinds: []string{"lexical"}}}}, nil
}

func testPolicy() model.SearchPolicy {
	return model.SearchPolicy{
		SchemaVersion: 2, Version: "search-policy-v2",
		QueryQuality: model.QueryQualityPolicy{MinSignalRunes: 2, MaxSymbolRatio: 0.6},
		Lexical: model.LexicalPolicy{FieldWeights: map[string]float64{
			"operation_id": 12, "plan_ref": 12, "path": 10, "provider_keys": 7,
			"summary": 5, "aliases": 4, "required_inputs": 3, "expected_outputs": 3,
			"step_instructions": 2, "description": 1.5, "search_text": 1,
		}},
		Candidates:  model.CandidatePolicy{Lexical: 50, Vector: 50, Limit: 20, MinVectorSimilarity: 0.35},
		Fusion:      model.FusionPolicy{RRFK: 60},
		Calibration: model.ScoreCalibrationPolicy{Version: "search-calibration-v1", Method: "exponential-rrf-v1", RRFScale: 30, ExactOperationBoost: 0.65, ExactPathBoost: 0.65, ExactProviderBoost: 0.25},
		Plan:        model.ThresholdPolicy{MinTop1Score: 0.34, MinMargin: 0.05},
		Endpoint:    model.EndpointThresholdPolicy{MinTop1Score: 0.30, MinCandidateScore: 0.20, MinMargin: 0.04},
		Rerank:      model.RerankPolicy{Model: "jina-reranker-v3", TopN: 20},
	}
}

func newService(servicesURL string) (*toolrouter.Service, io.Closer) {
	client, err := services.NewClient(services.Options{BaseURL: servicesURL, HTTPClient: &http.Client{}})
	if err != nil {
		log.Fatal(err)
	}
	backend := searchBackend{id: buildID}
	search, err := retrieval.NewService(backend, testPolicy())
	if err != nil {
		log.Fatal(err)
	}
	facts := model.Endpoint{
		OperationID: "getFacts", ProviderKey: "financial-datasets", HTTPMethod: http.MethodGet,
		PublicPath: "/apis/v1/financial/facts", Summary: "Get facts", Description: "Get structured company facts.", ReadOnly: true,
		Parameters:     []model.Parameter{{Name: "ticker", Location: "query", Required: true, Schema: json.RawMessage(`{"type":"string"}`)}},
		Response:       &model.PrimaryResponse{Content: []model.MediaSchema{{ContentType: "application/json", Schema: json.RawMessage(`{"type":"object"}`)}}},
		Pricing:        model.Pricing{Source: "runtime_overlay", Model: "fixed_per_request"},
		RuntimeBinding: model.RuntimeBinding{CatalogID: "financial-datasets"},
	}
	note := model.Endpoint{
		OperationID: "createNote", ProviderKey: "financial-datasets", HTTPMethod: http.MethodPost,
		PublicPath: "/apis/v1/financial/notes", Summary: "Create note", Description: "Create a note.",
		RequestBody: &model.RequestBody{Required: true, Content: []model.MediaSchema{{
			ContentType: "application/json", Schema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`),
		}}},
		Response:       &model.PrimaryResponse{Content: []model.MediaSchema{{ContentType: "application/json", Schema: json.RawMessage(`{"type":"object"}`)}}},
		Pricing:        model.Pricing{Source: "runtime_overlay", Model: "fixed_per_request"},
		RuntimeBinding: model.RuntimeBinding{CatalogID: "financial-datasets"},
	}
	catalog := bundle.Catalog{
		Manifest:  model.Manifest{BuildID: buildID},
		Endpoints: model.EndpointSnapshot{BuildID: buildID, Endpoints: []model.Endpoint{facts, note}},
		Plans:     model.PlanSnapshot{BuildID: buildID, Plans: []model.Plan{}}, Policy: testPolicy(),
	}
	service, err := toolrouter.New(toolrouter.Options{
		Catalog: catalog, Search: search, Overlay: client, Authenticator: client, Executor: client, Quoter: client, Concurrency: 2,
	})
	if err != nil {
		log.Fatal(err)
	}
	return service, backend
}

func main() {
	upstream := &stub{}
	servicesURL := startUpstream(upstream)
	service, closer := newService(servicesURL)
	runtime := toolrouter.NewRuntime()
	if err := runtime.Swap(service, closer); err != nil {
		log.Fatal(err)
	}
	defer runtime.Close()

	handlers, err := apihttp.NewRuntimeToolHandlers(runtime)
	if err != nil {
		log.Fatal(err)
	}
	httpRouter := apihttp.NewRouter(apihttp.ReadinessFunc(func() bool { return runtime.BuildID() != "" }), handlers)
	mcpHandler, err := apimcp.NewHandler(runtime)
	if err != nil {
		log.Fatal(err)
	}

	root := http.NewServeMux()
	root.HandleFunc("/__parity/dispatch", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPost && strings.HasSuffix(request.URL.Path, "/dispatch") && request.URL.RawQuery == "reset=1" {
			upstream.reset()
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		if request.Method == http.MethodPost {
			upstream.reset()
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(upstream.snapshot())
	})
	root.Handle("/mcp", mcpHandler)
	root.Handle("/", httpRouter)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	baseURL := "http://" + listener.Addr().String()
	ready, _ := json.Marshal(map[string]string{
		"base_url":     baseURL,
		"mcp_url":      baseURL + "/mcp",
		"dispatch_url": baseURL + "/__parity/dispatch",
	})
	if _, err := os.Stdout.Write(append(append([]byte("PARITY_READY "), ready...), '\n')); err != nil {
		log.Fatal(err)
	}

	server := &http.Server{Handler: root}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			log.Fatal(serveErr)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	_ = server.Close()
}
