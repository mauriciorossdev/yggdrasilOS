import { describe, expect, it } from "vitest";
import { fitColumns } from "./repoColumns.js";

describe("fitColumns", () => {
  it("keeps preferred widths that fit", () => {
    expect(fitColumns({ rail: 248, center: 400 }, 1300, false)).toEqual({ rail: 248, center: 400 });
  });

  it("raises the changes column to 30% and the rail to 180px", () => {
    expect(fitColumns({ rail: 100, center: 100 }, 1000, false)).toEqual({ rail: 180, center: 300 });
  });

  it("leaves the diff at least 30%, taking from the rail first", () => {
    expect(fitColumns({ rail: 400, center: 400 }, 1000, false)).toEqual({ rail: 300, center: 400 });
    expect(fitColumns({ rail: 180, center: 600 }, 1000, false)).toEqual({ rail: 180, center: 520 });
  });

  it("in split mode the diff gets at least half", () => {
    expect(fitColumns({ rail: 248, center: 400 }, 1200, true)).toEqual({ rail: 200, center: 400 });
    expect(fitColumns({ rail: 248, center: 600 }, 1200, true)).toEqual({ rail: 180, center: 420 });
    expect(fitColumns({ rail: 248, center: 400 }, 1000, true)).toEqual({ rail: 180, center: 320 });
  });

  it("a window too narrow for every minimum squeezes the rail", () => {
    expect(fitColumns({ rail: 248, center: 400 }, 800, true)).toEqual({ rail: 160, center: 240 });
  });
});
