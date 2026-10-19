// Preparatory, local-only generator. Reads five named sources; writes only this directory.
// Invocation: node docs/team-process/generate-bundle.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const dir = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const targets = [
  ['D:/Hermes/TeamProcess/PROC-P01-P16-v1.2.md', 'D:/Hermes/TeamProcess/PROC-P01-P16-v1.3.md', 'PROC-P01-P16-v1.3.md', '525f7ff8db801202de1d6ae27c49060dfe85ed3677111827e16d136a984fc7fa'],
  ...[
    ['lead', '5657996539b0ac88f504babe7f374591cb88e7f0dd3a64b0ae2bd6d56f765820'],
    ['programmer', '743b17b2832994b839aa6155b8a1bce9a7c48dd99607483eee8239eb0dfb7cd2'],
    ['reviewer', 'e68a007ab16b91255cca38947dd52f9d918550fb87e1fd30023c3c053619daef'],
    ['architect', '095cb4b0b553e52a02c98e4daa9031f00891b8709884eff25ae28eb2d4691c19'],
  ].map(([role, hash]) => [`C:/Users/Otrade/AppData/Local/hermes/profiles/${role}/SOUL.md`, `C:/Users/Otrade/AppData/Local/hermes/profiles/${role}/SOUL.md`, `${role}.SOUL.md`, hash]),
];
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error(`Expected one occurrence: ${before.slice(0, 90)}`);
  return text.replace(before, after);
}
const original = targets.map(([source, , , hash]) => {
  const bytes = readFileSync(source);
  if (sha(bytes) !== hash) throw Error(`Source drift: ${source}: ${sha(bytes)}`);
  return bytes.toString('utf8');
});
if (original.some(x => x.includes('\ufffd'))) throw Error('Invalid UTF-8 source');
const procPath = 'D:\\Hermes\\TeamProcess\\PROC-P01-P16-v1.3.md';
let proc = original[0];
proc = replaceOnce(proc, '# PROC-P01-P16 v1.2 — локальный регламент CFin', '# PROC-P01-P16 v1.3 — локальный регламент CFin');
proc = replaceOnce(proc,
  'Только после отдельного явного Owner разрешения на создание `D:/Hermes/TeamProcess/PROC-P01-P16-v1.2.md` и на правки трёх SOUL:',
  'Только после отдельного явного Owner разрешения на создание `D:/Hermes/TeamProcess/PROC-P01-P16-v1.3.md` и на правки четырёх SOUL:');
proc = replaceOnce(proc, 'во все три SOUL diff', 'во все четыре SOUL diff');
proc = replaceOnce(proc, 'регламент+три SOUL', 'регламент+четыре SOUL');
proc = replaceOnce(proc, 'совпадение трёх ссылок', 'совпадение четырёх ссылок');
proc = replaceOnce(proc,
  'Только после отдельного явного Owner разрешения на создание `D:/Hermes/TeamProcess/PROC-P01-P16-v1.3.md` и на правки четырёх SOUL: уполномоченный исполнитель читает фактические байты каждого файла, сохраняет адресные backup (с именами/хешами и без раскрытия секретов), проверяет отсутствие конкурентного изменения и точность контекста. Сначала материализует *ровно* этот регламент в разрешённом месте, read-back и SHA-256 фактически опубликованных байтов; подставляет один и тот же реальный SHA и version/path во все четыре SOUL diff. Подготовить единый финальный пакет регламент+четыре SOUL и провести **один независимый Review финального diff/hash/binding** перед применением SOUL. Если Reviewer требует изменения текста или адреса — обновить материализованный документ, заново вычислить hash и повторить Review изменённого финального пакета, не применять прежний diff. После разрешённого применения адресно проверить exact read-back каждой цели, hash документа и совпадение четырёх ссылок; при mismatch остановиться, сообщить, не делать слепой rollback. Никакой файл/backup не удалять без отдельного разрешения. Строки `<PUBLISHED_BYTES_SHA256>` в живые SOUL не записывать. Текущий Kanban-текст не является таким применением.',
  'До любой записи в пять живых целей подготовить полные окончательные байты нового регламента и четырёх SOUL, их точные SHA-256 и единый diff с контекстом и путями целей; все четыре SOUL уже содержат один и тот же окончательный path/version/hash регламента, без placeholder и последующей подстановки. Независимый Reviewer проверяет именно этот финальный пятицелевой пакет, исходные и итоговые хеши, binding и порядок применения **до** записи в любую живую цель. Изменение текста, пути или хеша после Review требует нового пакета и повторного независимого Review до применения. Принятие Review и подготовительный START сами по себе не разрешают применение. Только после отдельного явного Owner gate на точные пять целей/хешей, backup и уполномоченного совместимого исполнителя: заново прочитать исходные байты всех четырёх SOUL и старого регламента, сверить их хеши и отсутствие новой цели/конкурентных изменений, сохранить адресные backup существующих целей (имена/хеши, без раскрытия секретов). При drift, коллизии либо несовместимом доступе остановиться и вернуть пакет на Owner/Review. Исполнитель применяет только уже проверенные окончательные байты: staged/atomic замена где доступна, проверка точного SHA-256 регламента перед записью SOUL и адресный read-back SHA-256 каждой записанной цели и четырёх ссылок. Не генерировать новый diff и не подменять текст после Review. Частичная либо неоднозначная запись = UNKNOWN: остановиться, сохранить evidence, адресно прочитать фактическое состояние, без слепого повтора или rollback. Никакой файл/backup не удалять без отдельного разрешения. Текущий Kanban-текст не является применением.');
const endMarker = 'Конец полного проекта. Источники:';
const matrix = `## 10. Матрица предложения v1.3 (действует только после отдельного принятия Owner)
Эта версия и четыре SOUL применяются только после отдельного Owner gate на точные пять целей/хешей и независимого Review финальных байтов. Более строгие действующие Owner, developer, SOUL и tool boundaries имеют приоритет; текст не создаёт технический доступ и не удостоверяет роли.

Действие | Граница
--- | ---
Локальная разработка и тесты | Только внутри Owner START, binding и allowed paths отдельного worktree. Reviewer и Architect read-only, Lead не пишет проект и не проводит независимый Review.
Локальный commit | Только если прямо назван в START или отдельном Owner gate, после staged diff/hash/check; не означает push.
Push / draft PR / ready PR | Каждый названный внешний этап требует применимого Owner разрешения и точного read-back remote состояния. Независимый Review до публикации, если предписан данным gate. Принятие этого пакета не является разрешением на публикацию.
Clean local main fast-forward | Не выполняется Lead (developer запрещает проектные файлы) и Programmer (текущий feature-worktree-only boundary запрещает main). Только отдельный совместимый уполномоченный оператор после Owner gate с repository, ref, expected SHA, clean status, origin и ancestry; никакого reset/force/shared-config. Пока оператора нет — UNVERIFIED/NO-GO.
Task-owned disposable Docker | Только после явного START с локальными isolated resources, synthetic data, lifecycle и адресным cleanup. Никаких production volumes/compose/credentials; отказ в доступе к ресурсу не обходить.
Подготовка/тест миграции | Разрешённые файлы и одноразовые локальные данные при START; forward/rollback plan и тестовые evidence. Это не разрешает production DB write.
Production migration | Только внутри отдельного Owner DEPLOY с точным target, backup, data-preservation проверкой, steps и допущенным production оператором. Programmer напрямую production не меняет. Read-back/smoke; deploy не означает rollback.
Rollback | Отдельный Owner gate с целью и процедурой либо действительно заранее одобренная применимая emergency процедура. При UNKNOWN — stop/read-back, не повторять вслепую.
Restore / удаление данных / изменение доступа | Каждое требует отдельного адресного Owner gate, квалифицированного оператора и read-back. Не вытекает из START, DEPLOY, ROLLBACK или cleanup.
Функциональная/визуальная приёмка | Owner задаёт сценарий и среду. Reviewer отдельно сообщает code, независимый functional rerun и фактический visual inspection с snapshot, исполнителем, методом и PASS/CHANGES REQUIRED/UNVERIFIED. Недоступная ось — UNVERIFIED; собственный тест Programmer не независим.
MERGE / CLOSE / cleanup | Отдельные Owner MERGE и CLOSE, отдельный адресный gate для удаления ветки/worktree/evidence/backup.

Protected Coordination Card opt-in и N-06 affected egress остаются NO-GO; R02 T01–T10 не одобрены. Только фактически уполномоченный Global Lead может писать обычную каноническую Coordination Card. Global Lead/Tester не верифицированы как operational roles; runtime enforcement NO-GO/UNVERIFIED, IP conformance UNVERIFIED. Отказ локального метода записать буквально и продолжать только независимо разрешённые действия; запрет ресурса не обходить. Неоднозначная внешняя запись = UNKNOWN: stop и адресный read-back.

`;
proc = replaceOnce(proc, endMarker, matrix + endMarker);
proc = replaceOnce(proc,
  'v1.1 комментарии 41–47 остаются историческими; новая матрица §3 и процедура §7 имеют приоритет *только для рассмотрения предложения*, не как действующие полномочия.',
  'v1.1 комментарии 41–47 и оговорка прежнего проекта о приоритете §§3/7 только для рассмотрения остаются историческим происхождением до принятия. После отдельного Owner принятия точного пятицелевого пакета и разрешённого применения §§3/7 действуют лишь в пределах Owner scope и не отменяют более строгие developer, SOUL, tool и иные действующие ограничения; принятие не даёт START, доступа или права на внешние действия.');
// A new version has no historical v1.2 authority reference; prior versions remain historical outside this file.
if (proc.includes('v1.2') || proc.includes('трёх SOUL') || proc.includes('три SOUL')) throw Error('Stale authority reference');
const procHash = sha(Buffer.from(proc, 'utf8'));
const policy = {
  lead: `Matrix v1.3 (only after separate Owner adoption): local development/tests and an explicitly scoped local commit may be coordinated within START and binding. Each push, draft PR and ready PR requires applicable Owner gate and remote read-back; Review is not publication approval. Local main ff cannot be assigned to Lead under the higher-priority no-project-files boundary; Programmer's current no-main boundary also remains. A distinct compatible operator needs separate authorization; otherwise stop. Local disposable Docker and migration tests need scope, synthetic data and resource approval; production migration only within individually authorized DEPLOY by a permitted operator. Rollback, restore, deletion and access changes each require separate gate. No pilot, protected/N-06/R02 or new technical enforcement follows.`,
  programmer: `Matrix v1.3 (only after separate Owner adoption): local changes/tests inside verified START, isolated feature worktree and allowed paths; commit only if explicitly named. Push, draft PR and ready PR are individually scoped Owner-gated external stages with independent Review when required and exact remote read-back. Never update main under current boundary; any proposed clean local main ff belongs to a distinct compatible authorized operator after separate gate, not to Programmer or Lead. Local disposable Docker requires task-owned isolated resources and synthetic data within START; migration preparation/testing does not grant production DB access. Production migration only during individually authorized DEPLOY by an authorized production operator, not Programmer. Rollback, restore, data deletion and access changes require separate Owner gates; UNKNOWN stops dependent external actions. No protected/N-06/R02 or technical access follows.`,
  reviewer: `Matrix v1.3 (only after separate Owner adoption): remain read-only and independently assess exact diff and evidence; report code review, independently executed functional rerun, and actual visual inspection separately with snapshot, executor, method and PASS/CHANGES REQUIRED/UNVERIFIED. Missing modality is UNVERIFIED; Programmer self-test is not independent. Acceptance grants no commit, push, PR, ready, main update, Docker write, migration, MERGE, DEPLOY, rollback, restore, deletion, access change or CLOSE. No file-producing rerun, protected/N-06/R02 permission or technical enforcement follows.`,
  architect: `Matrix v1.3 (only after separate Owner adoption): remain read-only. Evaluate migration design, disposable local Docker/test evidence, data preservation and rollback plan without modifying files, Git, DB, Docker or production. Preparation/testing does not authorize production migration; only separately Owner-authorized DEPLOY with a qualified operator can include it. Rollback, restoration, data deletion and access changes each need separate Owner gate; main ff and publication need a compatible separately authorized operator. Protected/N-06/R02 and technical enforcement remain unchanged.`,
};
const generated = [proc];
for (let i = 1; i < targets.length; i++) {
  const role = targets[i][2].split('.')[0];
  let soul = original[i];
  const oldRef = 'After separate Owner adoption, use D:\\Hermes\\TeamProcess\\PROC-P01-P16-v1.2.md (version v1.2; SHA-256 525f7ff8db801202de1d6ae27c49060dfe85ed3677111827e16d136a984fc7fa)';
  const leadRef = 'After separate Owner adoption, follow D:\\Hermes\\TeamProcess\\PROC-P01-P16-v1.2.md (version v1.2; SHA-256 525f7ff8db801202de1d6ae27c49060dfe85ed3677111827e16d136a984fc7fa)';
  const ref = role === 'lead' ? leadRef : oldRef;
  if (role !== 'architect') soul = replaceOnce(soul, ref, ref.replace('PROC-P01-P16-v1.2.md', 'PROC-P01-P16-v1.3.md').replace('version v1.2', 'version v1.3').replace('525f7ff8db801202de1d6ae27c49060dfe85ed3677111827e16d136a984fc7fa', procHash));
  soul += (soul.endsWith('\n') ? '\n' : '\n\n') + `## Proposed matrix v1.3 (effective only on separate Owner adoption)\nProposed reference: ${procPath} (version v1.3; SHA-256 ${procHash}); verify exact bytes after separate Owner adoption.\n${policy[role]}\n`;
  if (soul.includes('v1.2')) throw Error(`Stale ${role} reference`);
  generated.push(soul);
}
// Verify every input and prospective output are properly newline-terminated; preserve all existing bytes,
// including architect's mixed original CRLF/LF; additions are UTF-8 LF without BOM.
for (let i = 0; i < targets.length; i++) {
  if (!original[i].endsWith('\n') || !generated[i].endsWith('\n')) throw Error(`Missing terminal newline: ${targets[i][0]}`);
  writeFileSync(join(dir, targets[i][2]), Buffer.from(generated[i], 'utf8'));
}
const manifest = targets.map(([oldPath, newPath, artifact, sourceSha], i) => ({
  oldPath, newPath, artifact, sourceSha256: sourceSha,
  finalSha256: sha(Buffer.from(generated[i], 'utf8')),
  oldCRLF: (original[i].match(/\r\n/g) || []).length,
  oldLFOnly: (original[i].match(/(?<!\r)\n/g) || []).length,
  finalCRLF: (generated[i].match(/\r\n/g) || []).length,
  finalLFOnly: (generated[i].match(/(?<!\r)\n/g) || []).length,
  terminalNewline: true,
}));
writeFileSync(join(dir, 'five-target-manifest.json'), JSON.stringify({ version: 'v1.3', encoding: 'UTF-8 without BOM', additions: 'LF; unchanged source bytes retained (including mixed endings)', targets: manifest }, null, 2) + '\n');
// Real git unified diffs, using exact target paths instead of local candidate paths in headers.
let patch = '';
for (let i = 0; i < targets.length; i++) {
  const [oldPath, newPath, artifact] = targets[i];
  const run = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--', oldPath, join(dir, artifact)], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (run.status !== 1 || run.error) throw Error(`git diff failed: ${oldPath}: ${run.stderr || run.error}`);
  const lines = run.stdout.split('\n');
  if (!lines[0].startsWith('diff --git ') || !lines[2].startsWith('--- ') || !lines[3].startsWith('+++ ')) throw Error('Unexpected git diff format');
  lines[0] = `diff --git a/${oldPath} b/${newPath}`;
  lines[2] = `--- a/${oldPath}`;
  lines[3] = `+++ b/${newPath}`;
  lines.splice(1, 1); // The manifest holds SHA-256; do not present it as a Git blob OID.
  patch += lines.join('\n');
}
writeFileSync(join(dir, 'five-targets.diff'), patch);
console.log(`PROC SHA-256 ${procHash}`);
for (const item of manifest) console.log(`${item.artifact}: ${item.sourceSha256} -> ${item.finalSha256}; CRLF ${item.oldCRLF}/${item.finalCRLF}; LF-only ${item.oldLFOnly}/${item.finalLFOnly}`);
console.log(`Diff SHA-256 ${sha(Buffer.from(patch))}`);
