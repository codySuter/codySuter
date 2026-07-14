using System.Text;

namespace OptiAudit.Core.Csv;

/// <summary>
/// RFC 4180-style CSV parsing and writing. No external dependencies so the
/// behavior is fully controlled and unit-tested — this tool clears live
/// inventory data, so parsing must be exact.
/// </summary>
public static class CsvFile
{
    /// <summary>
    /// Parses CSV text into records. Handles UTF-8 BOM, CRLF/LF/CR line endings,
    /// quoted fields containing commas/quotes/newlines, and skips blank lines.
    /// </summary>
    public static List<string[]> Parse(TextReader reader)
    {
        ArgumentNullException.ThrowIfNull(reader);

        var records = new List<string[]>();
        var fields = new List<string>();
        var field = new StringBuilder();
        bool inQuotes = false;
        bool fieldStart = true;
        bool recordHasContent = false;

        int ci;
        bool first = true;
        while ((ci = reader.Read()) != -1)
        {
            char c = (char)ci;
            if (first)
            {
                first = false;
                if (c == '﻿') continue; // UTF-8 BOM decoded as char
            }

            if (inQuotes)
            {
                if (c == '"')
                {
                    if (reader.Peek() == '"')
                    {
                        reader.Read();
                        field.Append('"');
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    field.Append(c);
                }
                continue;
            }

            switch (c)
            {
                case '"' when fieldStart:
                    inQuotes = true;
                    fieldStart = false;
                    recordHasContent = true;
                    break;
                case ',':
                    fields.Add(field.ToString());
                    field.Clear();
                    fieldStart = true;
                    recordHasContent = true;
                    break;
                case '\r':
                    if (reader.Peek() == '\n') reader.Read();
                    EndRecord();
                    break;
                case '\n':
                    EndRecord();
                    break;
                default:
                    field.Append(c);
                    fieldStart = false;
                    break;
            }
        }
        if (inQuotes)
            throw new FormatException(
                "The CSV ends inside a quoted field — the file looks truncated or corrupt. " +
                "Re-export it rather than risk an incomplete audit.");
        EndRecord();
        return records;

        void EndRecord()
        {
            if (field.Length > 0 || fields.Count > 0 || recordHasContent)
            {
                fields.Add(field.ToString());
                records.Add(fields.ToArray());
            }
            field.Clear();
            fields.Clear();
            fieldStart = true;
            recordHasContent = false;
        }
    }

    public static List<string[]> ParseText(string text)
    {
        using var reader = new StringReader(text);
        return Parse(reader);
    }

    /// <summary>
    /// Reads a CSV file. Uses any BOM; otherwise tries strict UTF-8 and falls
    /// back to Latin-1 so legacy ANSI exports don't turn "é"/"°" into
    /// replacement characters that would break exact matching.
    /// </summary>
    public static List<string[]> ParseFile(string path)
    {
        var strictUtf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
        try
        {
            using var reader = new StreamReader(path, strictUtf8, detectEncodingFromByteOrderMarks: true);
            return Parse(reader);
        }
        catch (DecoderFallbackException)
        {
            using var reader = new StreamReader(path, Encoding.Latin1, detectEncodingFromByteOrderMarks: true);
            return Parse(reader);
        }
    }

    /// <summary>Writes records as CRLF-terminated RFC 4180 CSV text.</summary>
    public static string Write(IEnumerable<IReadOnlyList<string>> records)
    {
        ArgumentNullException.ThrowIfNull(records);
        var sb = new StringBuilder();
        foreach (var record in records)
        {
            for (int i = 0; i < record.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(EscapeField(record[i]));
            }
            sb.Append("\r\n");
        }
        return sb.ToString();
    }

    public static string EscapeField(string? value)
    {
        value ??= string.Empty;
        bool needsQuotes = value.Contains(',') || value.Contains('"') ||
                           value.Contains('\r') || value.Contains('\n') ||
                           value.StartsWith(' ') || value.EndsWith(' ');
        if (!needsQuotes) return value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
