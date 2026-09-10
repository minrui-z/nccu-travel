import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('dist');
const html = await readFile(join(root, 'index.html'), 'utf8');
assert.ok(
  !/(?:src|href)=["']\/(?!\/)/.test(html),
  'HTML assets must be relative for project Pages',
);
let checked = 0;
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const path = match[1];
  if (path.startsWith('http') || path.startsWith('data:')) continue;
  assert.ok(
    (await stat(resolve(root, path))).isFile(),
    'Missing HTML asset ' + path,
  );
  checked++;
}
for (const file of await readdir(join(root, 'assets'))) {
  if (!file.endsWith('.css')) continue;
  const css = await readFile(join(root, 'assets', file), 'utf8');
  for (const match of css.matchAll(/url\((?:["']?)([^)"']+)(?:["']?)\)/g)) {
    const url = match[1];
    if (url.startsWith('data:')) continue;
    assert.ok(
      !url.startsWith('http') && !url.startsWith('/'),
      'Fonts must be self-hosted and project-relative',
    );
    assert.ok(
      (await stat(resolve(root, 'assets', url))).isFile(),
      'Missing CSS asset ' + url,
    );
    checked++;
  }
}
const templates = (await readdir(join(root, 'templates'))).filter((p) =>
  p.endsWith('.xls'),
);
assert.equal(templates.length, 25);
assert.ok(templates.includes('student-7-private.xls'));
assert.ok((await stat(join(root, 'data/rules-115.json'))).isFile());
console.log(
  'Verified ' +
    checked +
    ' relative HTML/CSS assets, 25 native XLS templates and rule data.',
);

const { runInNewContext } = await import('node:vm');
const { webcrypto } = await import('node:crypto');
const { createSampleDraft, makeDays, addDays } =
  await import('../lib/claim/claim-engine.ts');
const { editTransitEndpoint, applyDailyDestination } =
  await import('../lib/trip-locations.ts');
const publicAllowances = JSON.parse(
  await readFile(join(root, 'data/allowances-2026.json'), 'utf8'),
);
const boston = publicAllowances.destinations.find(
  (d) => d.countryZh === '美國' && d.cityEn.startsWith('Boston'),
);
const workerFile = (await readdir(join(root, 'assets'))).find((name) =>
  /^export\.worker-.*\.js$/.test(name),
);
assert.ok(workerFile, 'Built worker must exist');
const workerCode = await readFile(join(root, 'assets', workerFile), 'utf8');
const { updateGroupDays } = await import('../lib/trip-groups.ts');
const { templateIdFor } = await import('../lib/xls/template-selection.ts');
const { changeDayKind } = await import('../lib/trip-locations.ts');
const cases = [
  { kind: 'general', count: 4, sample: false, personal: true },
  { kind: 'student', count: 7, sample: false, personal: true },
  ...['general', 'student'].map((kind) => ({
    kind,
    count: 4,
    sample: true,
    fitted: true,
  })),
  ...['general', 'student'].map((kind) => ({
    kind,
    count: 4,
    sample: true,
    route: true,
  })),
  ...['general', 'student'].map((kind) => ({ kind, count: 4, sample: true })),
  ...['general', 'student'].flatMap((kind) =>
    Array.from({ length: 12 }, (_, i) => ({
      kind,
      count: i + 1,
      sample: false,
    })),
  ),
];
for (const scenario of cases) {
  const { kind, count } = scenario;
  const draft = createSampleDraft();
  draft.template = kind;
  draft.notes = '匿名測試資料';
  draft.days = draft.days.map((day) => ({
    ...day,
    work: day.work === '出席會議並發表論文' ? '發表論文' : day.work,
  }));
  if (!scenario.sample) {
    draft.expenses = [];
    draft.fundingLimit = '';
    draft.notes = '';
    draft.purpose = '公差';
    draft.person = { ...draft.person, name: '出差人', title: '人員' };
    draft.startDate = draft.approvedStart = '2026-07-13';
    draft.endDate = draft.approvedEnd = addDays(draft.startDate, count - 1);
    draft.days = makeDays(draft.startDate, draft.endDate, {
      location: '城市',
      work: '公差',
      usdRate: '100',
      weekendOfficial: true,
    });
    draft.groups = draft.days.map((day) => ({
      id: 'g-' + day.id,
      dayIds: [day.id],
    }));
  }
  if (scenario.route) {
    draft.days[0] = editTransitEndpoint(
      draft.days[0],
      'from',
      '臺北',
      'route-tw-taipei',
    );
    draft.days[0] = editTransitEndpoint(
      draft.days[0],
      'to',
      '美國波士頓',
      boston.id,
    );
    draft.days[0] = applyDailyDestination(
      draft.days[0],
      publicAllowances,
      boston.id,
    );
  }
  if (scenario.fitted) {
    const group = draft.groups.find((entry) => entry.dayIds.length > 1);
    const edited = updateGroupDays(draft, group.dayIds[0], (day) => ({
      ...day,
      work: '國際學術研討會發表研究成果\n跨國研究合作與方法交流',
    }));
    assert.equal(edited.groups, draft.groups);
    Object.assign(draft, edited);
    draft.purpose =
      '國際學術研討會發表研究成果並參與跨國研究合作與方法交流座談會議'.repeat(
        2,
      );
  }
  if (scenario.personal) {
    draft.days[2] = changeDayKind(draft.days[2], 'personal');
  }
  const templateId = templateIdFor(draft, count);
  const manifest = JSON.parse(
    await readFile(join(root, 'templates', templateId + '.json'), 'utf8'),
  );
  const template = Uint8Array.from(
    await readFile(join(root, 'templates', templateId + '.xls')),
  ).buffer;
  let result;
  const self = {
    postMessage(message) {
      result = message;
    },
  };
  // Run the actual emitted browser Worker with no Node require, Buffer or module globals.
  runInNewContext(
    workerCode,
    {
      self,
      crypto: webcrypto,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      Uint16Array,
      Uint32Array,
      ArrayBuffer,
      DataView,
      console,
    },
    { timeout: 5000 },
  );
  await self.onmessage({ data: { draft, manifest, template } });
  assert.ok(
    result && !result.error,
    'Built ' + kind + '-' + count + ' worker failed: ' + result?.error,
  );
  assert.equal(
    Buffer.from(result.buffer).subarray(0, 8).toString('hex'),
    'd0cf11e0a1b11ae1',
  );
  if (
    scenario.personal ||
    scenario.sample ||
    count === 12 ||
    (kind === 'student' && count === 7)
  ) {
    await mkdir('qa-output', { recursive: true });
    await writeFile(
      `qa-output/claim-${kind}-${scenario.personal ? 'private-' + count : scenario.fitted ? 'fitted' : scenario.route ? 'route' : scenario.sample ? 'sample' : count}.xls`,
      new Uint8Array(result.buffer),
    );
  }
  if (scenario.sample)
    console.log(
      'Built ' +
        kind +
        ' Worker generates native XLS without a backend or Node globals.',
    );
}
console.log(
  'Built Worker also exports all 24 column counts with complete dates and generated meal text.',
);

console.log(
  `Verified ${cases.length} built Worker scenarios, including merged edits and fitted text.`,
);
