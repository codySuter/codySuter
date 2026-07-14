using OptiAudit.Core.Model;

namespace OptiAudit.Core;

public sealed class MatchOptions
{
    /// <summary>Compare location values case-insensitively (recommended; Eagle locations are usually uppercase).</summary>
    public bool CaseInsensitive { get; init; } = true;

    /// <summary>
    /// Location fields that must NEVER be searched or cleared.
    /// Default is field 3 (used for shelf capacity at this store).
    /// </summary>
    public IReadOnlySet<int> ProtectedFields { get; init; } = DefaultProtectedFields;

    public static IReadOnlySet<int> DefaultProtectedFields { get; } = new HashSet<int> { 3 };

    public StringComparer Comparer => CaseInsensitive ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    public IEnumerable<int> SearchableFields()
    {
        for (int f = 1; f <= ItemRecord.LocationFieldCount; f++)
            if (!ProtectedFields.Contains(f))
                yield return f;
    }
}

/// <summary>A SKU whose location fields matched the OPTI code.</summary>
public sealed class SkuMatch
{
    public required ItemRecord Item { get; init; }

    /// <summary>Field numbers (1–6) that matched and WILL be cleared. Never contains a protected field.</summary>
    public required IReadOnlyList<int> MatchedFields { get; init; }

    /// <summary>Protected fields whose value also equals the code. Reported as a warning, never cleared.</summary>
    public required IReadOnlyList<int> ProtectedFieldHits { get; init; }
}

public sealed class MatchReport
{
    /// <summary>SKUs with at least one clearable (non-protected) matching field.</summary>
    public required IReadOnlyList<SkuMatch> Matches { get; init; }

    /// <summary>SKUs where the code was found ONLY in protected fields — surfaced so nothing is silently ignored.</summary>
    public required IReadOnlyList<SkuMatch> ProtectedOnlyMatches { get; init; }

    /// <summary>The normalized (trimmed, deduplicated) codes that were searched.</summary>
    public required IReadOnlyList<string> SearchedCodes { get; init; }

    public int TotalFieldsToClear => Matches.Sum(m => m.MatchedFields.Count);
}

public static class LocationMatcher
{
    /// <summary>
    /// Validates an OPTI/location code entered by the user.
    /// Returns an error message, or null when valid.
    /// </summary>
    public static string? ValidateCode(string? code)
    {
        var trimmed = (code ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return "Location code is empty.";
        if (!trimmed.Any(char.IsLetterOrDigit))
            return $"Location code \"{trimmed}\" must contain at least one letter or digit.";
        if (trimmed.Contains('?'))
            return $"Location code \"{trimmed}\" may not contain '?' (that is the FIL clear marker).";
        if (trimmed.Contains('*'))
            return $"Location code \"{trimmed}\" may not contain '*'.";
        return null;
    }

    /// <summary>
    /// Finds every item whose location fields exactly equal one of the codes.
    /// Values are trimmed before comparison. This is a whole-field comparison —
    /// code "54" never matches "540", "154" or "54A". Protected fields are
    /// checked only so hits there can be reported; they are never clearable.
    /// </summary>
    public static MatchReport FindMatches(IEnumerable<ItemRecord> items, IEnumerable<string> codes, MatchOptions options)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(codes);
        ArgumentNullException.ThrowIfNull(options);

        var codeSet = new HashSet<string>(options.Comparer);
        var normalizedCodes = new List<string>();
        foreach (var raw in codes)
        {
            var error = ValidateCode(raw);
            if (error != null)
                throw new ArgumentException(error, nameof(codes));
            var code = raw.Trim();
            if (codeSet.Add(code))
                normalizedCodes.Add(code);
        }
        if (normalizedCodes.Count == 0)
            throw new ArgumentException("At least one location code is required.", nameof(codes));

        var matches = new List<SkuMatch>();
        var protectedOnly = new List<SkuMatch>();

        foreach (var item in items)
        {
            // Rows without a SKU can't be updated through FIL; the validator
            // already warned about them, so they are skipped here too.
            if (item.Sku.Trim().Length == 0)
                continue;

            List<int>? matched = null;
            List<int>? protectedHits = null;

            for (int field = 1; field <= ItemRecord.LocationFieldCount; field++)
            {
                var value = item.LocationValue(field).Trim();
                if (value.Length == 0 || !codeSet.Contains(value))
                    continue;

                if (options.ProtectedFields.Contains(field))
                    (protectedHits ??= new List<int>()).Add(field);
                else
                    (matched ??= new List<int>()).Add(field);
            }

            if (matched == null && protectedHits == null)
                continue;

            var skuMatch = new SkuMatch
            {
                Item = item,
                MatchedFields = (IReadOnlyList<int>?)matched ?? Array.Empty<int>(),
                ProtectedFieldHits = (IReadOnlyList<int>?)protectedHits ?? Array.Empty<int>(),
            };

            if (matched != null)
                matches.Add(skuMatch);
            else
                protectedOnly.Add(skuMatch);
        }

        return new MatchReport
        {
            Matches = matches,
            ProtectedOnlyMatches = protectedOnly,
            SearchedCodes = normalizedCodes,
        };
    }
}
