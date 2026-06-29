import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSnapshot, scanSnapshot, StructureError } from "../src/index";
import { mapKpState } from "../src/util";
import type { Candidate } from "../src/types";

const FIXTURE = fileURLToPath(new URL("./fixtures/snapshot", import.meta.url));

function find(cands: Candidate[], entityType: string, naturalKey: string): Candidate | undefined {
  return cands.find((c) => c.entityType === entityType && c.naturalKey === naturalKey);
}
function all(cands: Candidate[], entityType: string): Candidate[] {
  return cands.filter((c) => c.entityType === entityType);
}

describe("scanner structure validation", () => {
  it("hard-fails on a missing path", () => {
    expect(() => scanSnapshot(join(FIXTURE, "..", "does-not-exist"))).toThrow(StructureError);
  });
  it("hard-fails when the path is a file, not a directory", () => {
    expect(() => scanSnapshot(join(FIXTURE, "teacher", "system.md"))).toThrow(StructureError);
  });
  it("records unsupported files (system.md) without dropping them", () => {
    const { documents } = parseSnapshot(FIXTURE);
    const sys = documents.find((d) => d.relPath === "teacher/system.md");
    expect(sys?.doc.status).toBe("unsupported");
  });
});

describe("course status + curriculum (4.10)", () => {
  const { candidates } = parseSnapshot(FIXTURE);
  it("passed history → 已通过", () => {
    expect(find(candidates, "course", "15044")?.payload.examStatus).toBe("已通过");
  });
  it("current-term subjects → 在考", () => {
    expect(find(candidates, "course", "02324")?.payload.examStatus).toBe("在考");
    expect(find(candidates, "course", "13180")?.payload.examStatus).toBe("在考");
  });
  it("重考 text wins over 在考", () => {
    expect(find(candidates, "course", "13015")?.payload.examStatus).toBe("重考");
  });
  it("future-term extra subject (日语 00840) imported as 未开始", () => {
    const jp = find(candidates, "course", "00840");
    expect(jp?.payload.examStatus).toBe("未开始");
    expect(jp?.payload.examTrack).toBe("2027-10");
  });
  it("exam tracks generated", () => {
    expect(find(candidates, "exam_track", "2026-10")).toBeDefined();
  });
});

describe("subject mapping + provisional (4.10)", () => {
  const { candidates, issues } = parseSnapshot(FIXTURE);
  it("maps discrete_math slug → 02324 via exam_plan", () => {
    expect(find(candidates, "subject", "discrete_math")?.payload.courseCode).toBe("02324");
  });
  it("slug absent from exam_plan → provisional course + unmapped + warning", () => {
    const course = find(candidates, "course", "PROV-stale_subject");
    expect(course?.payload.examStatus).toBe("unmapped");
    expect(issues.some((i) => i.kind === "unmapped_subject")).toBe(true);
  });
});

describe("public vs personal classification (4.7) — nothing unclassified", () => {
  const { candidates } = parseSnapshot(FIXTURE);
  it("every candidate is public or personal", () => {
    for (const c of candidates) {
      expect(["public", "personal"]).toContain(c.visibility);
      expect(c.payload.visibility).toBe(c.visibility);
    }
  });
  it("curriculum is public, learner state is personal", () => {
    expect(find(candidates, "knowledge_point", "02324:DM01-01")?.visibility).toBe("public");
    expect(find(candidates, "question", `02324:2004年4月真题:Q-01-001`)?.visibility).toBe("public");
    expect(all(candidates, "learner_kp_state")[0]?.visibility).toBe("personal");
    expect(all(candidates, "daily_log_entry").length).toBeGreaterThan(0);
    expect(all(candidates, "daily_log_entry")[0]?.visibility).toBe("personal");
  });
});

describe("mapKpState negation precedence (B1)", () => {
  it("未学习/未掌握/未练习 → unseen, not taught/mastered/practiced", () => {
    expect(mapKpState("未学习").state).toBe("unseen");
    expect(mapKpState("未掌握").state).toBe("unseen");
    expect(mapKpState("未练习").state).toBe("unseen");
  });
  it("已学习/已练习/已掌握 still map to their states", () => {
    expect(mapKpState("已学习").state).toBe("taught");
    expect(mapKpState("已练习").state).toBe("practiced");
    expect(mapKpState("已掌握").state).toBe("mastered");
  });
  it("non-canonical tokens never inflate: 部分掌握/未完全掌握 → unseen", () => {
    expect(mapKpState("部分掌握").state).toBe("unseen");
    expect(mapKpState("部分掌握").mapped).toBe(false); // unmapped → triggers warning upstream
    expect(mapKpState("未完全掌握").state).toBe("unseen");
    expect(mapKpState("未测试 → 已掌握").state).toBe("mastered"); // 已 present → resolves correctly
  });
});

describe("subject parsing (4.5)", () => {
  const { candidates, issues } = parseSnapshot(FIXTURE);
  it("knowledge points + chapter from syllabus", () => {
    expect(find(candidates, "knowledge_point", "02324:DM01-01")).toBeDefined();
    expect(find(candidates, "chapter", "02324:1")).toBeDefined();
  });
  it("progress 状态词汇 → KpState", () => {
    expect(find(candidates, "learner_kp_state", "ai-teacher-self:02324:DM01-01")?.payload.state).toBe("mastered");
    expect(find(candidates, "learner_kp_state", "ai-teacher-self:02324:DM01-02")?.payload.state).toBe("taught");
  });
  it("missing key_points.md → per-file skip warning, not failure", () => {
    expect(issues.some((i) => i.kind === "per_file_skipped" && i.message.includes("key_points"))).toBe(true);
  });
  it("mistake mapped to course (4.11)", () => {
    const m = find(candidates, "mistake", "02324:1");
    expect(m?.payload.courseCode).toBe("02324");
    expect(m?.payload.kpCode).toBe("DM01-02");
  });
});

describe("question bank (4.6) incl. compact YAML", () => {
  const { candidates } = parseSnapshot(FIXTURE);
  it("parses md questions + options + solution + kp link", () => {
    expect(find(candidates, "question", "02324:2004年4月真题:Q-01-001")).toBeDefined();
    expect(all(candidates, "question_option").length).toBeGreaterThanOrEqual(4);
    expect(find(candidates, "question_solution", "02324:2004年4月真题:Q-01-001:sol")).toBeDefined();
    expect(find(candidates, "question_kp_link", "02324:2004年4月真题:Q-01-001:kp:DM01-01")).toBeDefined();
  });
  it("parses compact YAML question", () => {
    expect(find(candidates, "question", "02324:2015年4月真题:Q-01-100")).toBeDefined();
  });
});

describe("review queue + dangling refs (4.11)", () => {
  const { candidates, issues } = parseSnapshot(FIXTURE);
  it("mappable review row → review_item", () => {
    expect(all(candidates, "review_item").some((c) => c.payload.kpCode === "DM01-01")).toBe(true);
  });
  it("unmappable review row → import_error (not dropped)", () => {
    expect(issues.some((i) => i.kind === "dangling_review_ref" && i.message.includes("ZZ99-99"))).toBe(true);
  });
});

describe("cross-file warnings (4.11)", () => {
  const { issues } = parseSnapshot(FIXTURE);
  it("kp total drift (dashboard 30 vs syllabus 2)", () => {
    expect(issues.some((i) => i.kind === "kp_total_drift")).toBe(true);
  });
  it("stats declared vs parsed mismatch", () => {
    expect(issues.some((i) => i.kind === "stats_count_mismatch")).toBe(true);
  });
});

describe("idempotency at the parse layer (stable natural keys, 4.9)", () => {
  it("re-parsing the same snapshot yields identical keys/ids/hashes", () => {
    const a = parseSnapshot(FIXTURE).candidates.map((c) => `${c.entityType}|${c.naturalKey}|${c.payload.id}|${c.payload.contentHash}`).sort();
    const b = parseSnapshot(FIXTURE).candidates.map((c) => `${c.entityType}|${c.naturalKey}|${c.payload.id}|${c.payload.contentHash}`).sort();
    expect(a).toEqual(b);
  });

  it("content change keeps natural key + id, changes content hash (update not create)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "legacy-import-"));
    cpSync(FIXTURE, tmp, { recursive: true });
    const before = find(parseSnapshot(tmp).candidates, "knowledge_point", "02324:DM01-01")!;

    const syl = join(tmp, "teacher/subjects/discrete_math/syllabus.md");
    writeFileSync(syl, readFileSync(syl, "utf8").replace("命题与命题联结词", "命题与命题联结词（修订）"));
    const after = find(parseSnapshot(tmp).candidates, "knowledge_point", "02324:DM01-01")!;

    expect(after.naturalKey).toBe(before.naturalKey);
    expect(after.payload.id).toBe(before.payload.id);
    expect(after.payload.contentHash).not.toBe(before.payload.contentHash);
  });
});
