using System.Collections.Concurrent;
using System.Globalization;
using System.Threading.Channels;
using PMSystem2.Api.Models;

namespace PMSystem2.Api.Services.Cpk;

/// <summary>Tunable settings, bound from the "Cpk" section of appsettings.</summary>
public sealed class CpkOptions
{
    /// <summary>Number of most recent OK samples per (Channel, Job, Step).</summary>
    public int SampleSize { get; set; } = 50;
    /// <summary>Minimum samples before a CPK is reported (fewer -> INSUFFICIENT_DATA, no CPK).</summary>
    public int MinSamples { get; set; } = 30;
    /// <summary>How often queued samples are applied, persisted and broadcast.</summary>
    public int FlushIntervalSeconds { get; set; } = 10;
    /// <summary>Maximum queued PCB results waiting for the next flush.</summary>
    public int QueueCapacity { get; set; } = 50_000;
    /// <summary>History scanned once to seed the table, and the retention of idle keys.</summary>
    public int BootstrapDays { get; set; } = 90;
    /// <summary>A Channel only ranks Jobs/Steps that ran within this window of its latest sample.</summary>
    public int ActiveJobWindowDays { get; set; } = 7;
    /// <summary>Minimum CPK change that is pushed to the web (band changes are always pushed).</summary>
    public double BroadcastMinDelta { get; set; } = 0.01;
    /// <summary>Running sums are recomputed exactly after this many updates of a key.</summary>
    public int ExactRecomputeEvery { get; set; } = 1000;
    /// <summary>Pause between bootstrap query steps so live traffic keeps priority.</summary>
    public int BootstrapStepDelayMs { get; set; } = 1000;
}

public readonly record struct CpkKey(int ChannelId, string JobFile, int StepNumber, string StepName);

/// <summary>One measurement of a CPK step, still as raw text from the tester.</summary>
public readonly record struct CpkStepInput(int StepNumber, string StepName, string? StepType,
    string? Value, string? SpecMin, string? SpecMax, string? Result = null);

/// <summary>One OK PCB result queued for CPK processing.</summary>
public sealed record CpkPcbInput(int StationId, int ChannelId, string JobFile, string Pid,
    DateTime InspectTime, CpkStepInput[] Steps);

/// <summary>Immutable, thread-safe view of one key published after each flush.</summary>
public sealed record CpkKeySnapshot(
    CpkKey Key, int StationId, string? StepType, int SampleCount,
    double? SpecMin, double? SpecMax, double? Mean, double? StandardDeviation,
    double? Cpl, double? Cpu, double? Cpk, string Status,
    DateTime FirstTime, DateTime LastTime, DateTime CalculatedAt, CpkPointDto[] Points);

/// <summary>
/// Incremental CPK engine. Request threads only enqueue; a single background
/// loop (<see cref="CpkEngineService"/>) owns all mutable state, so no locks are
/// needed on the hot path. Readers see immutable snapshots.
/// </summary>
public sealed class CpkEngine
{
    internal sealed class KeyState
    {
        public KeyState(int capacity)
        {
            Values = new double[capacity];
            Pids = new string[capacity];
            Times = new DateTime[capacity];
        }

        public int StationId;
        public string? StepType;
        public readonly double[] Values;   // sorted by Times ascending
        public readonly string[] Pids;
        public readonly DateTime[] Times;
        public int Count;
        public double? SpecMin, SpecMax;
        public DateTime SpecTime = DateTime.MinValue;
        // Running sums of (x - Shift) keep mean/variance O(1) per sample and
        // avoid catastrophic cancellation for values with a large offset.
        public double Shift, Sum, SumSq;
        public int UpdatesSinceExact;
        public DateTime LastTime => Count == 0 ? DateTime.MinValue : Times[Count - 1];
    }

    private readonly CpkOptions _options;
    private readonly ILogger<CpkEngine> _logger;
    private readonly Channel<CpkPcbInput> _queue;
    private long _dropped;
    private DateTime _lastDropLog = DateTime.MinValue;

    // ---- state owned by the background loop only ----
    internal readonly Dictionary<CpkKey, KeyState> States = new();
    internal readonly Dictionary<int, HashSet<CpkKey>> KeysByChannel = new();
    internal readonly HashSet<CpkKey> Dirty = new();
    internal readonly HashSet<(int StationId, string JobFile, int StepNumber, string StepName, string? StepType)> NewCatalogEntries = new();
    private readonly Dictionary<(string Raw, bool IsMax), double?> _specParseCache = new();

    // ---- published, read from any thread ----
    private readonly ConcurrentDictionary<CpkKey, CpkKeySnapshot> _snapshots = new();
    private volatile Dictionary<int, CpkCacheOverviewDto> _overview = new();

    // Results from before a rebuild (data-version change). Shown for Channels that
    // have no new CPK yet, then dropped when the rebuild completes, so the page
    // never goes blank while history is being reloaded.
    private volatile Dictionary<int, CpkCacheOverviewDto>? _previousOverview;
    private volatile ConcurrentDictionary<CpkKey, CpkKeySnapshot>? _previousSnapshots;

    public bool IsRebuilding => _previousOverview != null;

    public CpkEngine(Microsoft.Extensions.Options.IOptions<CpkOptions> options, ILogger<CpkEngine> logger)
    {
        _options = options.Value;
        _options.SampleSize = Math.Clamp(_options.SampleSize, 2, 1000);
        _options.MinSamples = Math.Clamp(_options.MinSamples, 2, _options.SampleSize);
        _logger = logger;
        _queue = System.Threading.Channels.Channel.CreateBounded<CpkPcbInput>(new BoundedChannelOptions(Math.Max(1000, _options.QueueCapacity))
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropWrite,
        });
    }

    public CpkOptions Options => _options;
    public bool IsReady { get; internal set; }

    // =====================================================================
    // Producer side (request threads)
    // =====================================================================

    /// <summary>Queues the measurement steps of a saved OK PCB. Never blocks.</summary>
    public void Enqueue(PcbResult pcb)
    {
        if (pcb.Result != "OK" && pcb.Result != "PASS") return;
        if (pcb.TestSteps == null || pcb.TestSteps.Count == 0) return;

        var steps = new CpkStepInput[pcb.TestSteps.Count];
        int i = 0;
        foreach (var s in pcb.TestSteps)
            steps[i++] = new CpkStepInput(s.StepNumber, s.StepName, s.StepType, s.Value, s.SpecMin, s.SpecMax, s.Result);

        var item = new CpkPcbInput(pcb.StationId, pcb.ChannelId, pcb.JobFile ?? string.Empty,
            pcb.Pid, StoredWallClockToUtc(pcb.InspectTime), steps);
        if (_queue.Writer.TryWrite(item)) return;

        var dropped = Interlocked.Increment(ref _dropped);
        var now = DateTime.UtcNow;
        if (now - _lastDropLog > TimeSpan.FromMinutes(1))
        {
            _lastDropLog = now;
            _logger.LogWarning("CPK queue is full; {Dropped} PCB results were skipped for CPK since start.", dropped);
        }
    }

    // =====================================================================
    // Reader side (API threads)
    // =====================================================================

    public List<CpkCacheOverviewDto> GetOverview() => EffectiveOverview().Values.ToList();

    /// <summary>New results, plus the previous result of Channels without a new CPK during a rebuild.</summary>
    internal IReadOnlyDictionary<int, CpkCacheOverviewDto> EffectiveOverview()
    {
        var current = _overview;
        var previous = _previousOverview;
        if (previous == null) return current;
        var merged = new Dictionary<int, CpkCacheOverviewDto>(previous);
        foreach (var (channelId, row) in current)
            if (row.Cpk != null || !previous.ContainsKey(channelId)) merged[channelId] = row;
        return merged;
    }

    public bool TryGetAnalysis(int channelId, string? jobFile, int stepNumber, string stepName, out CpkAnalysisDto analysis)
    {
        analysis = null!;
        var key = new CpkKey(channelId, jobFile ?? string.Empty, stepNumber, stepName);
        _snapshots.TryGetValue(key, out var s);
        var previous = _previousSnapshots;
        if ((s == null || s.Cpk == null) && previous != null && previous.TryGetValue(key, out var old) && old.Cpk != null)
            s = old;
        if (s == null) return false;
        analysis = new CpkAnalysisDto(channelId, stepNumber, stepName, s.FirstTime, s.SampleCount,
            s.SpecMin, s.SpecMax, s.Mean, s.StandardDeviation, s.Cpl, s.Cpu, s.Cpk,
            s.Points.ToList(), IsHistorical(s.FirstTime));
        return true;
    }

    // =====================================================================
    // Background loop side
    // =====================================================================

    internal int DrainQueue(int maxItems)
    {
        int applied = 0;
        while (applied < maxItems && _queue.Reader.TryRead(out var item))
        {
            foreach (var step in item.Steps)
                AddSample(item.StationId, item.ChannelId, item.JobFile, step, item.Pid, item.InspectTime);
            applied++;
        }
        return applied;
    }

    /// <summary>Applies one raw measurement. Returns false when it is not a usable CPK sample.</summary>
    internal bool AddSample(int stationId, int channelId, string jobFile, in CpkStepInput step, string pid, DateTime inspectTime)
    {
        if (string.IsNullOrWhiteSpace(step.StepName)) return false;
        // An OK PCB can still carry FAIL step rows (e.g. an RF band that failed
        // and passed on retest); those measurements are out of spec by
        // definition and must not enter the capability study.
        if (!IsPassingStep(step.Result)) return false;
        // Steps without numeric limits (e.g. "-", text) are rejected before the
        // value is parsed; their spec strings are cached, so this is a lookup.
        var specMin = ParseSpec(step.SpecMin, false);
        if (specMin == null) return false;
        var specMax = ParseSpec(step.SpecMax, true);
        if (specMax == null) return false;
        if (!TryParseNumber(step.Value, out var value)) return false;

        var key = new CpkKey(channelId, jobFile, step.StepNumber, step.StepName);
        if (!States.TryGetValue(key, out var state))
        {
            state = new KeyState(_options.SampleSize) { StationId = stationId, StepType = step.StepType, Shift = value };
            States[key] = state;
            if (!KeysByChannel.TryGetValue(channelId, out var set))
                KeysByChannel[channelId] = set = new HashSet<CpkKey>();
            set.Add(key);
            NewCatalogEntries.Add((stationId, jobFile, step.StepNumber, step.StepName, step.StepType));
        }
        else if (state.StationId != stationId)
        {
            state.StationId = stationId;
        }

        if (!Insert(state, value, pid, inspectTime)) return false;
        // Limits come from the newest sample, matching the previous behaviour.
        if (inspectTime >= state.SpecTime)
        {
            state.SpecMin = specMin; state.SpecMax = specMax; state.SpecTime = inspectTime;
        }
        Dirty.Add(key);
        return true;
    }

    /// <summary>Restores a persisted key without marking it dirty.</summary>
    internal void Restore(CpkKey key, int stationId, string? stepType, double? specMin, double? specMax,
        double[] values, string[] pids, DateTime[] times)
    {
        var state = CreateState(stationId, stepType, specMin, specMax, values, pids, times);
        if (state == null) return;
        States[key] = state;
        if (!KeysByChannel.TryGetValue(key.ChannelId, out var set))
            KeysByChannel[key.ChannelId] = set = new HashSet<CpkKey>();
        set.Add(key);
        _snapshots[key] = BuildSnapshot(key, state, DateTime.UtcNow, _options.MinSamples);
    }

    /// <summary>Loads the results saved before a rebuild; they are display-only.</summary>
    internal void LoadPrevious(IEnumerable<(CpkKey Key, int StationId, string? StepType, double? SpecMin, double? SpecMax,
        double[] Values, string[] Pids, DateTime[] Times)> rows)
    {
        var now = DateTime.UtcNow;
        var snapshots = new ConcurrentDictionary<CpkKey, CpkKeySnapshot>();
        foreach (var row in rows)
        {
            var state = CreateState(row.StationId, row.StepType, row.SpecMin, row.SpecMax, row.Values, row.Pids, row.Times);
            if (state != null) snapshots[row.Key] = BuildSnapshot(row.Key, state, now, _options.MinSamples);
        }
        var overview = new Dictionary<int, CpkCacheOverviewDto>();
        foreach (var group in snapshots.Values.GroupBy(s => s.Key.ChannelId))
        {
            var best = SelectBestFrom(group.Key, group);
            if (best?.Cpk != null) overview[group.Key] = best;
        }
        _previousSnapshots = snapshots;
        _previousOverview = overview;
    }

    /// <summary>
    /// Ends a rebuild: drops the previous results and returns the rows to push for
    /// Channels whose displayed value changes (a placeholder when it becomes N/A).
    /// </summary>
    internal List<CpkCacheOverviewDto> EndRebuild()
    {
        var previous = _previousOverview;
        var changes = new List<CpkCacheOverviewDto>();
        if (previous == null) return changes;
        var current = _overview;
        foreach (var (channelId, old) in previous)
        {
            if (current.TryGetValue(channelId, out var row))
            {
                // A new CPK was already displayed; only Channels still showing the
                // previous value change now (to "insufficient samples").
                if (row.Cpk == null) changes.Add(row);
            }
            else
            {
                changes.Add(new CpkCacheOverviewDto(channelId, string.Empty, 0, string.Empty, 0, null, null, null,
                    null, null, null, null, DateTime.UtcNow, DateTime.UtcNow, false));
            }
        }
        _previousOverview = null;
        _previousSnapshots = null;
        return changes;
    }

    private KeyState? CreateState(int stationId, string? stepType, double? specMin, double? specMax,
        double[] values, string[] pids, DateTime[] times)
    {
        var n = Math.Min(values.Length, Math.Min(pids.Length, times.Length));
        if (n == 0) return null;
        var state = new KeyState(_options.SampleSize) { StationId = stationId, StepType = stepType, Shift = values[0] };
        // Keep only the newest SampleSize points if the setting was lowered.
        var order = Enumerable.Range(0, n).OrderBy(i => times[i]).Skip(Math.Max(0, n - _options.SampleSize)).ToArray();
        foreach (var i in order)
        {
            state.Values[state.Count] = values[i];
            state.Pids[state.Count] = pids[i] ?? string.Empty;
            state.Times[state.Count] = ToUtc(times[i]);
            state.Count++;
        }
        state.SpecMin = specMin; state.SpecMax = specMax; state.SpecTime = state.LastTime;
        RecomputeExact(state);
        return state;
    }

    private bool Insert(KeyState s, double value, string pid, DateTime time)
    {
        int cap = s.Values.Length;
        if (s.Count == cap && time <= s.Times[0]) return false; // older than everything kept

        // Binary search the insert position (array is sorted by time ascending).
        int lo = 0, hi = s.Count;
        while (lo < hi)
        {
            int mid = (lo + hi) >> 1;
            if (s.Times[mid] <= time) lo = mid + 1; else hi = mid;
        }
        // Same PCB delivered twice (live upload + bootstrap scan, or a replay).
        for (int j = lo - 1; j >= 0 && s.Times[j] == time; j--)
            if (string.Equals(s.Pids[j], pid, StringComparison.Ordinal)) return false;

        if (s.Count == cap)
        {
            // Full: drop the oldest sample (index 0) by shifting [1, lo) left;
            // that frees slot lo-1, which is exactly the sorted position.
            // lo >= 1 here because time > Times[0].
            RemoveFromSums(s, s.Values[0]);
            int pos = lo - 1;
            if (pos > 0)
            {
                Array.Copy(s.Values, 1, s.Values, 0, pos);
                Array.Copy(s.Pids, 1, s.Pids, 0, pos);
                Array.Copy(s.Times, 1, s.Times, 0, pos);
            }
            s.Values[pos] = value; s.Pids[pos] = pid; s.Times[pos] = time;
        }
        else
        {
            if (lo < s.Count)
            {
                Array.Copy(s.Values, lo, s.Values, lo + 1, s.Count - lo);
                Array.Copy(s.Pids, lo, s.Pids, lo + 1, s.Count - lo);
                Array.Copy(s.Times, lo, s.Times, lo + 1, s.Count - lo);
            }
            s.Values[lo] = value; s.Pids[lo] = pid; s.Times[lo] = time;
            s.Count++;
        }
        var d = value - s.Shift;
        s.Sum += d; s.SumSq += d * d;
        if (++s.UpdatesSinceExact >= _options.ExactRecomputeEvery) RecomputeExact(s);
        return true;
    }

    private static void RemoveFromSums(KeyState s, double value)
    {
        var d = value - s.Shift;
        s.Sum -= d; s.SumSq -= d * d;
    }

    private static void RecomputeExact(KeyState s)
    {
        s.Shift = s.Count > 0 ? s.Values[s.Count - 1] : 0;
        double sum = 0, sumSq = 0;
        for (int i = 0; i < s.Count; i++)
        {
            var d = s.Values[i] - s.Shift;
            sum += d; sumSq += d * d;
        }
        s.Sum = sum; s.SumSq = sumSq; s.UpdatesSinceExact = 0;
    }

    /// <summary>Recomputes dirty keys, republishes the overview and returns changed Channel rows to push.</summary>
    internal (List<(CpkKey Key, KeyState State, CpkKeySnapshot Snapshot)> Persist, List<CpkCacheOverviewDto> Broadcast)
        PublishDirty(IReadOnlyDictionary<int, CpkCacheOverviewDto> lastBroadcast)
    {
        var now = DateTime.UtcNow;
        var persist = new List<(CpkKey, KeyState, CpkKeySnapshot)>(Dirty.Count);
        var touchedChannels = new HashSet<int>();
        foreach (var key in Dirty)
        {
            if (!States.TryGetValue(key, out var state)) continue;
            var snapshot = BuildSnapshot(key, state, now, _options.MinSamples);
            _snapshots[key] = snapshot;
            persist.Add((key, state, snapshot));
            touchedChannels.Add(key.ChannelId);
        }
        Dirty.Clear();

        var broadcast = new List<CpkCacheOverviewDto>();
        if (touchedChannels.Count == 0) return (persist, broadcast);

        var overview = new Dictionary<int, CpkCacheOverviewDto>(_overview);
        foreach (var channelId in touchedChannels)
        {
            var best = SelectBest(channelId);
            if (best == null) { overview.Remove(channelId); continue; }
            overview[channelId] = best;
            var keepPrevious = best.Cpk == null && _previousOverview?.ContainsKey(channelId) == true;
            lastBroadcast.TryGetValue(channelId, out var previous);
            if (!keepPrevious && ShouldBroadcast(previous, best)) broadcast.Add(best);
        }
        _overview = overview;
        return (persist, broadcast);
    }

    /// <summary>Rebuilds the whole overview (used after startup restore).</summary>
    internal void RebuildOverview()
    {
        var overview = new Dictionary<int, CpkCacheOverviewDto>();
        foreach (var channelId in KeysByChannel.Keys)
        {
            var best = SelectBest(channelId);
            if (best != null) overview[channelId] = best;
        }
        _overview = overview;
    }

    internal IReadOnlyDictionary<int, CpkCacheOverviewDto> CurrentOverview => _overview;

    /// <summary>True when every step the Channel measures already has a full sample window.</summary>
    internal bool ChannelKeysFull(int channelId)
    {
        if (!KeysByChannel.TryGetValue(channelId, out var keys) || keys.Count == 0) return false;
        foreach (var key in keys)
            if (!States.TryGetValue(key, out var s) || s.Count < _options.SampleSize) return false;
        return true;
    }

    /// <summary>True when the Channel has a key with enough valid samples for a CPK.</summary>
    internal bool ChannelHasReady(int channelId, DateTime? newerThan = null)
    {
        if (!KeysByChannel.TryGetValue(channelId, out var keys)) return false;
        foreach (var key in keys)
            if (States.TryGetValue(key, out var s) && IsStudyReady(s) && (newerThan == null || s.LastTime >= newerThan))
                return true;
        return false;
    }

    private bool IsStudyReady(KeyState s)
    {
        if (s.Count < Math.Max(2, _options.MinSamples) || s.SpecMin == null || s.SpecMax == null) return false;
        var variance = (s.SumSq - s.Sum * s.Sum / s.Count) / (s.Count - 1);
        return variance > 1e-24;
    }

    /// <summary>
    /// Removes keys idle since before the retention cutoff, but only on Channels that
    /// already have a fresh CPK. A Channel that stopped running keeps its older study
    /// (found by the history fallback) instead of falling back to N/A.
    /// </summary>
    internal List<CpkKey> PruneStale(DateTime cutoff)
    {
        var removed = new List<CpkKey>();
        var freshChannels = new Dictionary<int, bool>();
        foreach (var (key, state) in States)
        {
            if (state.LastTime >= cutoff) continue;
            if (!freshChannels.TryGetValue(key.ChannelId, out var fresh))
                freshChannels[key.ChannelId] = fresh = ChannelHasReady(key.ChannelId, cutoff);
            if (fresh) removed.Add(key);
        }
        foreach (var key in removed)
        {
            States.Remove(key);
            _snapshots.TryRemove(key, out _);
            if (KeysByChannel.TryGetValue(key.ChannelId, out var set))
            {
                set.Remove(key);
                if (set.Count == 0) KeysByChannel.Remove(key.ChannelId);
            }
            Dirty.Remove(key);
        }
        if (removed.Count > 0) RebuildOverview();
        return removed;
    }

    private CpkCacheOverviewDto? SelectBest(int channelId)
    {
        if (!KeysByChannel.TryGetValue(channelId, out var keys) || keys.Count == 0) return null;
        var snapshots = new List<CpkKeySnapshot>(keys.Count);
        foreach (var key in keys)
            if (_snapshots.TryGetValue(key, out var s)) snapshots.Add(s);
        return SelectBestFrom(channelId, snapshots);
    }

    private CpkCacheOverviewDto? SelectBestFrom(int channelId, IEnumerable<CpkKeySnapshot> candidates)
    {
        var list = candidates as IReadOnlyCollection<CpkKeySnapshot> ?? candidates.ToList();
        if (list.Count == 0) return null;
        DateTime latest = DateTime.MinValue;
        foreach (var s in list)
            if (s.LastTime > latest) latest = s.LastTime;
        var activeFrom = latest.AddDays(-_options.ActiveJobWindowDays);

        // Only keys with a reportable CPK (>= MinSamples) compete for "best".
        // If none qualifies, report the active key with the most samples and
        // no CPK, so the web shows "Thiếu mẫu (n/50)" instead of a fake value.
        CpkKeySnapshot? best = null, mostSamples = null;
        foreach (var s in list)
        {
            if (s.LastTime < activeFrom) continue;
            if (mostSamples == null || s.SampleCount > mostSamples.SampleCount
                || (s.SampleCount == mostSamples.SampleCount && s.Key.StepNumber < mostSamples.Key.StepNumber))
                mostSamples = s;
            if (s.Cpk == null) continue;
            if (best == null
                || s.Cpk > best.Cpk
                || (s.Cpk == best.Cpk && s.SampleCount > best.SampleCount)
                || (s.Cpk == best.Cpk && s.SampleCount == best.SampleCount && s.Key.StepNumber < best.Key.StepNumber))
                best = s;
        }
        best ??= mostSamples;
        if (best == null) return null;
        return new CpkCacheOverviewDto(channelId, best.Key.JobFile, best.Key.StepNumber, best.Key.StepName,
            best.SampleCount, best.SpecMin, best.SpecMax, best.Mean, best.StandardDeviation,
            best.Cpl, best.Cpu, best.Cpk, best.CalculatedAt, best.FirstTime, IsHistorical(best.FirstTime), best.LastTime);
    }

    private bool ShouldBroadcast(CpkCacheOverviewDto? previous, CpkCacheOverviewDto current)
    {
        if (previous == null) return true;
        if (previous.StepNumber != current.StepNumber || previous.StepName != current.StepName
            || previous.JobFile != current.JobFile) return true;
        if (Band(previous.Cpk) != Band(current.Cpk)) return true;
        if (previous.Cpk == null || current.Cpk == null) return previous.Cpk != current.Cpk;
        return Math.Abs(previous.Cpk.Value - current.Cpk.Value) >= _options.BroadcastMinDelta;
    }

    private static int Band(double? cpk) => cpk == null ? -1 : cpk >= 1.33 ? 2 : cpk >= 1 ? 1 : 0;

    private static CpkKeySnapshot BuildSnapshot(CpkKey key, KeyState s, DateTime now, int minSamples)
    {
        int n = s.Count;
        double? mean = null, std = null, cpl = null, cpu = null, cpk = null;
        string status;
        if (n > 0) mean = s.Shift + s.Sum / n;
        if (n > 1)
        {
            var variance = (s.SumSq - s.Sum * s.Sum / n) / (n - 1);
            std = variance > 0 ? Math.Sqrt(variance) : 0;
        }
        if (n < Math.Max(2, minSamples)) status = "INSUFFICIENT_DATA";
        else if (s.SpecMin == null || s.SpecMax == null) status = "INVALID_SPEC";
        else if (std is null or <= 1e-12) status = "ZERO_VARIANCE";
        else
        {
            status = "READY";
            cpl = (mean!.Value - s.SpecMin.Value) / (3 * std.Value);
            cpu = (s.SpecMax.Value - mean.Value) / (3 * std.Value);
            cpk = Math.Min(cpl.Value, cpu.Value);
        }

        var points = new CpkPointDto[n];
        for (int i = 0; i < n; i++) points[i] = new CpkPointDto(s.Pids[i], s.Times[i], s.Values[i]);
        return new CpkKeySnapshot(key, s.StationId, s.StepType, n, s.SpecMin, s.SpecMax, mean, std,
            cpl, cpu, cpk, status, n > 0 ? s.Times[0] : now, s.LastTime, now, points);
    }

    private double? ParseSpec(string? raw, bool isMax)
    {
        if (raw == null) return null;
        var cacheKey = (raw, isMax);
        if (_specParseCache.TryGetValue(cacheKey, out var cached)) return cached;
        double? parsed = TryParseNumber(raw, out var v) ? v : null;
        if (_specParseCache.Count > 100_000) _specParseCache.Clear();
        _specParseCache[cacheKey] = parsed;
        return parsed;
    }

    /// <summary>Strict, allocation-free number parsing (accepts "," as decimal separator).</summary>
    internal static bool TryParseNumber(string? text, out double value)
    {
        value = 0;
        if (string.IsNullOrEmpty(text)) return false;
        var span = text.AsSpan().Trim();
        if (span.IsEmpty) return false;
        if (double.TryParse(span, NumberStyles.Float, CultureInfo.InvariantCulture, out value))
            return double.IsFinite(value);
        if (span.IndexOf(',') < 0 || span.Length > 64) return false;
        Span<char> buffer = stackalloc char[span.Length];
        span.CopyTo(buffer);
        for (int i = 0; i < buffer.Length; i++) if (buffer[i] == ',') buffer[i] = '.';
        return double.TryParse(buffer, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
            && double.IsFinite(value);
    }

    internal static bool IsPassingStep(string? result)
    {
        if (string.IsNullOrWhiteSpace(result)) return true;
        var r = result.AsSpan().Trim();
        return r.Equals("OK", StringComparison.OrdinalIgnoreCase) || r.Equals("PASS", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Converts a saved PcbResult time to UTC exactly as PostgreSQL stored it.
    /// Testers send local wall-clock time and PcbService only labels it UTC; with
    /// Npgsql's legacy timestamp behaviour the label is ignored and the wall clock
    /// is stored in the session time zone (the server's local zone, UTC+07). Using
    /// the label here would shift live samples by +7 h versus rows read from the DB.
    /// </summary>
    internal static DateTime StoredWallClockToUtc(DateTime value) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(value, DateTimeKind.Unspecified), TimeZoneInfo.Local);

    internal static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    private static bool IsHistorical(DateTime firstTime)
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        return firstTime < monthStart;
    }
}
