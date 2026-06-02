<?php

namespace App\Services;

use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Collection;

class ReportExportService
{
    public function __construct(
        private readonly AttendanceReportService $reports
    ) {}

    /**
     * @return array{content: string, mime: string, filename: string}
     */
    public function export(
        string $format,
        string $reportType,
        array $params,
    ): array {
        return match ($format) {
            'csv' => $this->exportCsv($reportType, $params),
            'xlsx', 'excel' => $this->exportExcel($reportType, $params),
            'pdf' => $this->exportPdf($reportType, $params),
            default => throw new \InvalidArgumentException("Unsupported format: {$format}"),
        };
    }

    private function exportCsv(string $reportType, array $params): array
    {
        [$headers, $rows, $basename] = $this->buildTable($reportType, $params);
        $lines = [implode(',', array_map([$this, 'csvCell'], $headers))];
        foreach ($rows as $row) {
            $lines[] = implode(',', array_map([$this, 'csvCell'], array_values($row)));
        }

        return [
            'content' => implode("\n", $lines),
            'mime' => 'text/csv',
            'filename' => "{$basename}.csv",
        ];
    }

    private function exportExcel(string $reportType, array $params): array
    {
        [$headers, $rows, $basename] = $this->buildTable($reportType, $params);

        $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n";
        $xml .= '<?mso-application progid="Excel.Sheet"?>'."\n";
        $xml .= '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ';
        $xml .= 'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'."\n";
        $xml .= '<Worksheet ss:Name="Report"><Table>'."\n";

        $xml .= '<Row>';
        foreach ($headers as $header) {
            $xml .= '<Cell><Data ss:Type="String">'.$this->xmlEscape($header).'</Data></Cell>';
        }
        $xml .= '</Row>'."\n";

        foreach ($rows as $row) {
            $xml .= '<Row>';
            foreach (array_values($row) as $cell) {
                $type = is_numeric($cell) && $cell !== '' ? 'Number' : 'String';
                $xml .= '<Cell><Data ss:Type="'.$type.'">'.$this->xmlEscape((string) $cell).'</Data></Cell>';
            }
            $xml .= '</Row>'."\n";
        }

        $xml .= '</Table></Worksheet></Workbook>';

        return [
            'content' => $xml,
            'mime' => 'application/vnd.ms-excel',
            'filename' => "{$basename}.xls",
        ];
    }

    private function exportPdf(string $reportType, array $params): array
    {
        [$headers, $rows, $basename] = $this->buildTable($reportType, $params);
        $title = match ($reportType) {
            'daily' => 'Daily Attendance Report — '.($params['date'] ?? date('Y-m-d')),
            'monthly' => 'Monthly Attendance Report — '.sprintf(
                '%04d-%02d',
                (int) ($params['year'] ?? date('Y')),
                (int) ($params['month'] ?? date('m'))
            ),
            default => 'Attendance Report',
        };

        $summaryHtml = '';
        if ($reportType === 'daily') {
            $daily = $this->reports->daily($params['date'] ?? now()->toDateString(), $params['location_id'] ?? null);
            $summaryHtml = '<p><strong>Present:</strong> '.$daily['present']
                .' &nbsp; <strong>Absent:</strong> '.$daily['absent']
                .' &nbsp; <strong>Late:</strong> '.$daily['late']
                .' &nbsp; <strong>On Leave:</strong> '.$daily['on_leave'].'</p>';
        } elseif ($reportType === 'monthly') {
            $monthly = $this->reports->monthly(
                (int) ($params['year'] ?? now()->year),
                (int) ($params['month'] ?? now()->month),
                $params['location_id'] ?? null
            );
            $s = $monthly['summary'];
            $summaryHtml = '<p><strong>Working days:</strong> '.$s['total_working_days']
                .' &nbsp; <strong>Attendance:</strong> '.$s['attendance_percent'].'%'
                .' &nbsp; <strong>Overtime:</strong> '.round($s['overtime_minutes'] / 60, 1).' hrs'
                .' &nbsp; <strong>Absences:</strong> '.$s['absence_count'].'</p>';
        }

        $html = '<html><head><style>
            body { font-family: DejaVu Sans, sans-serif; font-size: 11px; }
            h1 { font-size: 16px; margin-bottom: 4px; }
            p { color: #555; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
            th { background: #f0f0f0; }
        </style></head><body>';
        $html .= '<h1>'.htmlspecialchars($title).'</h1>';
        $html .= $summaryHtml;
        $html .= '<p>Generated '.date('Y-m-d H:i:s').'</p>';
        $html .= '<table><thead><tr>';
        foreach ($headers as $header) {
            $html .= '<th>'.htmlspecialchars($header).'</th>';
        }
        $html .= '</tr></thead><tbody>';
        foreach ($rows as $row) {
            $html .= '<tr>';
            foreach (array_values($row) as $cell) {
                $html .= '<td>'.htmlspecialchars((string) $cell).'</td>';
            }
            $html .= '</tr>';
        }
        $html .= '</tbody></table></body></html>';

        $options = new Options;
        $options->set('isRemoteEnabled', false);
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4', 'landscape');
        $dompdf->render();

        return [
            'content' => $dompdf->output(),
            'mime' => 'application/pdf',
            'filename' => "{$basename}.pdf",
        ];
    }

    /** @return array{0: string[], 1: array<int, array<string, scalar>>, 2: string} */
    private function buildTable(string $reportType, array $params): array
    {
        return match ($reportType) {
            'daily' => $this->dailyTable($params),
            'monthly' => $this->monthlyTable($params),
            'detail' => $this->detailTable($params),
            default => throw new \InvalidArgumentException("Unsupported report type: {$reportType}"),
        };
    }

    private function dailyTable(array $params): array
    {
        $date = $params['date'] ?? now()->toDateString();
        $report = $this->reports->daily($date, $params['location_id'] ?? null);

        $headers = [
            'Work Date',
            'Employee Code',
            'Employee Name',
            'Status',
            'Check In',
            'Check Out',
            'Worked (min)',
            'Overtime (min)',
        ];

        $rows = collect($report['employees'])->map(fn ($e) => [
            $date,
            $e['employee_code'],
            $e['employee_name'],
            $e['status'],
            $e['check_in_at'] ? date('H:i:s', strtotime($e['check_in_at'])) : '',
            $e['check_out_at'] ? date('H:i:s', strtotime($e['check_out_at'])) : '',
            $e['worked_minutes'],
            $e['overtime_minutes'],
        ])->all();

        if (empty($rows)) {
            $rows[] = [
                $date,
                '',
                '',
                "Present: {$report['present']}, Absent: {$report['absent']}, Late: {$report['late']}, On Leave: {$report['on_leave']}",
                '',
                '',
                '',
                '',
            ];
        }

        return [$headers, $rows, "daily-attendance-{$date}"];
    }

    private function monthlyTable(array $params): array
    {
        $year = (int) ($params['year'] ?? now()->year);
        $month = (int) ($params['month'] ?? now()->month);
        $report = $this->reports->monthly($year, $month, $params['location_id'] ?? null);

        $headers = [
            'Employee Code',
            'Employee Name',
            'Department',
            'Working Days',
            'Attendance %',
            'Overtime (hrs)',
            'Absences',
            'Late',
            'On Leave',
        ];

        $rows = collect($report['employees'])->map(fn ($e) => [
            $e['employee_code'],
            $e['employee_name'],
            $e['department'] ?? '',
            $e['total_working_days'],
            $e['attendance_percent'],
            $e['overtime_hours'],
            $e['absence_count'],
            $e['late_count'],
            $e['on_leave_count'],
        ])->all();

        $basename = sprintf('monthly-attendance-%04d-%02d', $year, $month);

        return [$headers, $rows, $basename];
    }

    private function detailTable(array $params): array
    {
        $from = $params['date_from'] ?? now()->toDateString();
        $to = $params['date_to'] ?? $from;
        $rows = $this->reports->detailRows($from, $to, $params['location_id'] ?? null);

        $headers = [
            'Work Date',
            'Employee Code',
            'Employee Name',
            'Department',
            'Check In',
            'Check Out',
            'Worked (min)',
            'Overtime (min)',
            'Status',
        ];

        $tableRows = $rows->map(fn ($r) => [
            $r['work_date'],
            $r['employee_code'],
            $r['employee_name'],
            $r['department'],
            $r['check_in'],
            $r['check_out'],
            $r['worked_minutes'],
            $r['overtime_minutes'],
            $r['status'],
        ])->all();

        return [$headers, $tableRows, "attendance-detail-{$from}-{$to}"];
    }

    private function csvCell(mixed $value): string
    {
        return '"'.str_replace('"', '""', (string) $value).'"';
    }

    private function xmlEscape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
