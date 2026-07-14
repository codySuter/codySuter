namespace OptiAudit.Core.Model;

/// <summary>One SKU row from a Compass inventory export.</summary>
public sealed class ItemRecord
{
    public const int LocationFieldCount = 6;

    /// <summary>1-based data row number in the source file (header excluded).</summary>
    public required int RowNumber { get; init; }

    public required string Sku { get; init; }

    public string Description { get; init; } = string.Empty;

    public string Store { get; init; } = string.Empty;

    /// <summary>
    /// Raw location field values. Index 0 = Location 1 … index 5 = Location 6.
    /// Always length 6; unmapped or missing cells are empty strings.
    /// </summary>
    public required string[] Locations { get; init; }

    public string LocationValue(int fieldNumber)
    {
        if (fieldNumber < 1 || fieldNumber > LocationFieldCount)
            throw new ArgumentOutOfRangeException(nameof(fieldNumber));
        return Locations[fieldNumber - 1] ?? string.Empty;
    }
}
