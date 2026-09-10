import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSampleDraft } from '../lib/claim/claim-engine';
import {
  capacityIssuesForDraft,
  destinationForIssue,
  fieldPathCandidates,
} from '../lib/issue-navigation';
import { fitClaimText } from '../lib/xls/text-fitting';
import type { TemplateManifest } from '../lib/xls/template-manifest';

test('validation links select the reported day, including a day inside a merged group', () => {
  const draft = createSampleDraft();
  assert.deepEqual(destinationForIssue({ path: 'days.3.usdRate' }, draft), {
    tab: 'trip',
    focus: `day:${draft.days[3].id}`,
  });
  assert.deepEqual(destinationForIssue({ path: 'receiptCount' }, draft), {
    tab: 'check',
    focus: 'period',
  });
  assert.deepEqual(destinationForIssue({ path: 'expenses.2.fxRate' }, draft), {
    tab: 'cost',
    focus: 'expenses',
  });
  assert.deepEqual(fieldPathCandidates('days.3.transit.from'), [
    'days.3.transit.from',
    'days.3.transit',
    'days.3',
    'days',
  ]);
});

const manifest = JSON.parse(
  readFileSync(
    new URL('../public/templates/student-4.json', import.meta.url),
    'utf8',
  ),
) as TemplateManifest;

test('overflow keeps source metadata and links to the actual merged date input', () => {
  const draft = createSampleDraft();
  const groupIndex = draft.groups.findIndex((group) => group.dayIds.length > 1);
  assert.ok(groupIndex >= 0);
  const cell = manifest.segments[groupIndex].fields.work;
  const content = '完整工作記要'.repeat(100);
  const fitted = fitClaimText(manifest, {
    [manifest.sheetName]: { [cell]: content },
  });
  const [issue] = capacityIssuesForDraft(fitted.issues, draft);
  const dayIndex = draft.days.findIndex(
    (day) => day.id === draft.groups[groupIndex].dayIds[0],
  );
  assert.equal(issue.fieldKey, 'work');
  assert.equal(issue.segmentIndex, groupIndex);
  assert.equal(issue.cell, cell);
  assert.equal(issue.path, `days.${dayIndex}.work`);
  assert.ok(issue.message.includes(draft.days[dayIndex].date));
  assert.doesNotMatch(issue.message, /8pt|print\.|[A-N]\d{1,2}/);
  assert.equal(
    destinationForIssue(issue, draft).focus,
    `day:${draft.days[dayIndex].id}`,
  );
  assert.equal(fitted.changes[manifest.sheetName][cell], content);
});

test('transit location overflow exposes both endpoints without targeting a hidden stay-city input', () => {
  const draft = createSampleDraft();
  const first = draft.groups[0].dayIds[0];
  const index = draft.days.findIndex((day) => day.id === first);
  draft.days[index].kind = 'flight';
  const cell = manifest.segments[0].fields.location;
  const fitted = fitClaimText(manifest, {
    [manifest.sheetName]: { [cell]: '跨國交通地點'.repeat(100) },
  });
  const [issue] = capacityIssuesForDraft(fitted.issues, draft);
  assert.equal(issue.path, `days.${index}.transit.from`);
  assert.deepEqual(issue.relatedFields, [
    { path: `days.${index}.transit.to`, label: '抵達地點' },
  ]);
});

test('expense and receipt overflow routes every contributing expense in its date group', () => {
  const draft = createSampleDraft();
  const date = draft.days.find(
    (day) => day.id === draft.groups[1].dayIds[0],
  )!.date;
  draft.expenses = [
    {
      ...draft.expenses[0],
      id: 'a',
      date,
      category: 'land',
      description: '車票甲',
    },
    {
      ...draft.expenses[0],
      id: 'b',
      date,
      category: 'land',
      description: '車票乙',
    },
    {
      ...draft.expenses[0],
      id: 'c',
      date,
      category: 'handling',
      description: '手續費',
    },
  ];
  for (const key of ['land', 'receipt']) {
    const cell = manifest.segments[1].fields[key];
    const fitted = fitClaimText(manifest, {
      [manifest.sheetName]: { [cell]: '超長完整內容'.repeat(100) },
    });
    const [issue] = capacityIssuesForDraft(fitted.issues, draft);
    assert.equal(
      issue.path,
      key === 'receipt' ? 'expenses.0.receipt' : 'expenses.0',
    );
    assert.equal(issue.relatedFields?.length, key === 'receipt' ? 2 : 1);
    assert.match(
      issue.message,
      new RegExp(key === 'receipt' ? '單據號數' : '陸運費'),
    );
    assert.deepEqual(destinationForIssue(issue, draft), {
      tab: 'cost',
      focus: 'expenses',
    });
  }
});

test('personal and notes overflow resolve to their editable paths instead of print coordinates', () => {
  const draft = createSampleDraft();
  const changes = Object.fromEntries(
    ['name', 'identity', 'reason', 'notes'].map((key) => [
      String(manifest.fields[key]),
      '長文字'.repeat(1000),
    ]),
  );
  const issues = capacityIssuesForDraft(
    fitClaimText(manifest, { [manifest.sheetName]: changes }).issues,
    draft,
  );
  assert.deepEqual(
    issues.map((issue) => issue.path),
    ['person.name', 'person.identifier', 'purpose', 'notes'],
  );
});

test('a shared work cell exposes each editable date group without pointing into hidden private fields', () => {
  const draft = createSampleDraft();
  draft.groups = draft.days.map((day) => ({
    id: `group-${day.id}`,
    dayIds: [day.id],
  }));
  draft.days[0].kind = 'personal';
  const shared = JSON.parse(
    readFileSync(
      new URL('../public/templates/student-7.json', import.meta.url),
      'utf8',
    ),
  ) as TemplateManifest;
  const cell = shared.segments[0].fields.work;
  const fitted = fitClaimText(shared, {
    [shared.sheetName]: { [cell]: '完整工作記要'.repeat(100) },
  });
  const [issue] = capacityIssuesForDraft(fitted.issues, draft);
  assert.ok((issue.segmentIndexes?.length ?? 0) > 1);
  assert.equal(issue.path, 'days.1.work');
  assert.ok(issue.relatedFields?.some((field) => field.path === 'days.2.work'));
  assert.ok(
    issue.relatedFields?.every((field) => field.path !== 'days.0.work'),
  );
});

test('prior-approval errors navigate to the page where the applicable checkbox is rendered', () => {
  const draft = createSampleDraft();
  const issue = { path: 'funding.priorApproval' };
  draft.funding = { ...draft.funding!, type: 'nstc', activityRole: 'approved' };
  draft.expenses = [];
  assert.equal(destinationForIssue(issue, draft).tab, 'person');
  const expense = {
    ...createSampleDraft().expenses[0],
    category: 'registration' as const,
    administrativeType: 'registration' as const,
  };
  draft.expenses = [expense];
  assert.equal(destinationForIssue(issue, draft).tab, 'person');
  draft.expenses[0].administrativeType = 'other';
  assert.equal(destinationForIssue(issue, draft).tab, 'cost');
  draft.expenses[0].administrativeType = 'registration';
  draft.funding.type = 'other';
  assert.equal(destinationForIssue(issue, draft).tab, 'cost');
});
