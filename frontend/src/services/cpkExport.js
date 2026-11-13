const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const reportTimestamp = now => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(now).replace(/\D/g, '');

// Export the exact measurements used by the displayed study, including any
// historical fallback. Keep full numeric precision and original timestamps.
export function createCpkRawExport({ channel, station, analysis, lineName = '' }, now = new Date()) {
  if (!analysis?.points?.length) return null;

  const headers = [
    'Line', 'Station', 'Model Group', 'Channel ID', 'Channel', 'Job File',
    'Step Number', 'Step Name', 'PID', 'Inspect Time (ISO 8601)', 'Value',
    'LSL (CPK)', 'USL (CPK)', 'CPK', 'Mean', 'Standard Deviation',
    'Sample Count', 'Data From', 'Includes Historical Data',
  ];
  const rows = analysis.points.map(point => [
    lineName, station.name, station.modelGroupName, channel.id,
    channel.name || channel.channelName || `Channel ${channel.id}`, station.cpkJobFile,
    analysis.stepNumber, analysis.stepName, point.pid, point.inspectTime, point.value,
    analysis.specMin, analysis.specMax, analysis.cpk, analysis.mean, analysis.standardDeviation,
    analysis.sampleCount, analysis.fromDate, analysis.isHistorical ? 'YES' : 'NO',
  ]);
  const timestamp = reportTimestamp(now);

  return {
    filename: `CPK_Raw_Channel_${channel.id}_Step_${analysis.stepNumber}_${timestamp}.csv`,
    content: '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
  };
}

export function downloadCpkRawData(detail) {
  const file = createCpkRawExport(detail);
  if (!file) return;
  downloadFile(new Blob([file.content], { type: 'text/csv;charset=utf-8;' }), file.filename);
}

export function downloadCpkReport(blob, now = new Date()) {
  downloadFile(blob, `CPK_Report_All_${reportTimestamp(now)}.xlsx`);
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
