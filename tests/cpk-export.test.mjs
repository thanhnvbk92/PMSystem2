import assert from 'node:assert/strict';
import test from 'node:test';
import { createCpkRawExport } from '../frontend/src/services/cpkExport.js';

const detail = {
  lineName: 'Line 1-1',
  station: { name: 'GPS, Audio', modelGroupName: 'Mẫu "A"', cpkJobFile: 'A.JOB' },
  channel: { id: 12, name: 'Jig 01' },
  analysis: {
    stepNumber: 104, stepName: 'Đo dòng\nkiểm tra', specMin: 0, specMax: 20,
    cpk: 1.23456789012345, mean: 10, standardDeviation: 0.01, sampleCount: 1,
    fromDate: '2026-10-01T00:00:00+07:00', isHistorical: true,
    points: [{ pid: '001234', inspectTime: '2026-10-31T23:59:59+07:00', value: 10.1234567890123 }],
  },
};

test('CSV preserves raw precision, source timestamps, historical period, and text escaping', () => {
  const file = createCpkRawExport(detail, new Date('2026-11-03T18:02:03Z'));
  assert.equal(file.filename, 'CPK_Raw_Channel_12_Step_104_20261104010203.csv');
  assert.ok(file.content.startsWith('\uFEFF"Line","Station"'));
  assert.ok(file.content.includes('"GPS, Audio","Mẫu ""A"""'));
  assert.ok(file.content.includes('"Đo dòng\nkiểm tra","001234","2026-10-31T23:59:59+07:00","10.1234567890123","0","20","1.23456789012345"'));
  assert.ok(file.content.endsWith('"2026-10-01T00:00:00+07:00","YES"\r\n'));
});

test('exports every displayed sample without fetching a different study', () => {
  const input = structuredClone(detail);
  input.analysis.stepName = 'Measurement';
  input.analysis.isHistorical = false;
  input.analysis.sampleCount = 50;
  input.analysis.points = Array.from({ length: 50 }, (_, index) => ({
    pid: `PCB-${index}`, inspectTime: '2026-11-04T08:00:00+07:00', value: index,
  }));
  const file = createCpkRawExport(input);
  assert.equal(file.content.trimEnd().split('\r\n').length, 51);
  assert.ok(file.content.includes('"PCB-49","2026-11-04T08:00:00+07:00","49"'));
  assert.ok(file.content.endsWith('"NO"\r\n'));
  assert.equal(input.analysis.points.length, 50);
});

test('missing statistics stay empty, while zero-valued measurements remain zero', () => {
  const input = structuredClone(detail);
  input.analysis.cpk = null;
  input.analysis.specMin = null;
  input.analysis.points[0].value = 0;
  const file = createCpkRawExport(input);
  assert.ok(file.content.includes('"0","","20","","10","0.01"'));
  assert.ok(!file.content.includes('"null"'));
});

test('does not produce a misleading export when raw points are unavailable', () => {
  assert.equal(createCpkRawExport({ ...detail, analysis: null }), null);
  assert.equal(createCpkRawExport({ ...detail, analysis: { sampleCount: 50, points: [] } }), null);
});
