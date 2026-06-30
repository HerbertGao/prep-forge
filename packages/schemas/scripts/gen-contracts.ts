// Zod = SoT → JSON Schema 导出（D1）。Python 侧锁版本 datamodel-code-generator 由这些文件生成
// Pydantic；两侧 CI「重生成 + git diff --exit-code」守漂移。
//
// 确定性：z.toJSONSchema 输出按字段定义顺序、zod 4.4.3 固定 → 同输入同字节。写入用 2 空格缩进 +
// 末尾换行，便于 git diff 守卫。运行：pnpm --filter @prep-forge/schemas contracts:gen
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import {
  ModelCall,
  QualityGateResult,
  PrepJobRecord,
  GenerationSource,
  PrepGenerateRequest,
  PrepGenerateResult,
} from "../src/index.ts";

// 跨语言边界契约：DB-row（worker/BFF 写库）+ transport 信封（worker↔BFF）+ provenance。
const CONTRACTS = {
  ModelCall,
  QualityGateResult,
  PrepJobRecord,
  GenerationSource,
  PrepGenerateRequest,
  PrepGenerateResult,
} as const;

const outDir = new URL("../contracts/", import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(CONTRACTS)) {
  const json = z.toJSONSchema(schema);
  const file = new URL(`${name}.json`, outDir);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote contracts/${name}.json`);
}
