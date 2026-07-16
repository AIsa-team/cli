import { describe, it, expect } from "vitest";
import * as agent from "../src/commands/agent.js";

describe("agent command surface", () => {
  it("exports the five consumer actions", () => {
    for (const name of [
      "agentListAction", "agentInfoAction", "agentInstallAction",
      "agentUpdateAction", "agentGuideAction",
    ]) expect(agent, name).toHaveProperty(name);
  });
});
