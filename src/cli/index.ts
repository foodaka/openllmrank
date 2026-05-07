#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { initCmd } from "./init";
import { runCmd } from "./run";
import { reportCmd } from "./report";
import { exportCmd } from "./export";
import { suggestCmd } from "./suggest";

const main = defineCommand({
  meta: {
    name: "openllmrank",
    version: "0.2.1",
    description: "Track how your brand appears in answers from AI search providers",
  },
  subCommands: {
    init: initCmd,
    run: runCmd,
    report: reportCmd,
    export: exportCmd,
    suggest: suggestCmd,
  },
});

runMain(main);
