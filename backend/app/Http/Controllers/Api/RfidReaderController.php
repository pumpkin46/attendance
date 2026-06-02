<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RfidReader;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class RfidReaderController extends Controller
{
    public function __construct(private readonly AuditService $audit) {}

    public function index(Request $request): JsonResponse
    {
        $readers = RfidReader::with('location')
            ->when($request->location_id, fn ($q, $id) => $q->where('location_id', $id))
            ->orderBy('name')
            ->get()
            ->map(fn (RfidReader $reader) => $this->formatReader($reader));

        return response()->json($readers);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'location_id' => 'required|exists:locations,id',
            'name' => 'required|string|max:255',
            'device_id' => 'nullable|string|max:255|unique:rfid_readers,device_id',
            'direction' => 'in:in,out,both',
        ]);

        if (empty($data['device_id'])) {
            $data['device_id'] = $this->generateDeviceId($data['name']);
        }

        $data['direction'] ??= 'both';
        $plainToken = Str::random(40);
        $data['api_token'] = hash('sha256', $plainToken);

        $reader = RfidReader::create($data);
        $this->audit->log('rfid_reader.created', $reader);

        $formatted = $this->formatReader($reader->load('location'));
        $formatted['api_token_plain'] = $plainToken;

        return response()->json($formatted, 201);
    }

    public function show(RfidReader $rfidReader): JsonResponse
    {
        return response()->json($this->formatReader($rfidReader->load('location')));
    }

    public function update(Request $request, RfidReader $rfidReader): JsonResponse
    {
        $old = $rfidReader->toArray();
        $rfidReader->update($request->validate([
            'name' => 'sometimes|string|max:255',
            'location_id' => 'sometimes|exists:locations,id',
            'direction' => 'in:in,out,both',
            'is_active' => 'boolean',
        ]));
        $this->audit->log('rfid_reader.updated', $rfidReader, $old, $rfidReader->fresh()->toArray());

        return response()->json($this->formatReader($rfidReader->fresh()->load('location')));
    }

    public function destroy(RfidReader $rfidReader): JsonResponse
    {
        $rfidReader->update(['is_active' => false]);
        $this->audit->log('rfid_reader.deactivated', $rfidReader);

        return response()->json(['message' => 'RFID reader deactivated']);
    }

    public function regenerateToken(RfidReader $rfidReader): JsonResponse
    {
        $plainToken = Str::random(40);
        $rfidReader->update(['api_token' => hash('sha256', $plainToken)]);
        $this->audit->log('rfid_reader.token_regenerated', $rfidReader);

        return response()->json([
            'id' => $rfidReader->id,
            'api_token_plain' => $plainToken,
            'message' => 'Token regenerated. Update the physical reader with the new token.',
        ]);
    }

    private function formatReader(RfidReader $reader): array
    {
        $heartbeatTimeout = config('attendance.rfid_reader_offline_seconds', 300);
        $online = $reader->last_heartbeat_at
            && $reader->last_heartbeat_at->gte(now()->subSeconds($heartbeatTimeout));

        return [
            'id' => $reader->id,
            'name' => $reader->name,
            'device_id' => $reader->device_id,
            'direction' => $reader->direction,
            'is_active' => $reader->is_active,
            'online' => $online && $reader->is_active,
            'last_heartbeat_at' => $reader->last_heartbeat_at,
            'location' => $reader->location,
            'taps_today' => $reader->events()->whereDate('tapped_at', today())->count(),
        ];
    }

    private function generateDeviceId(string $name): string
    {
        $base = Str::upper(Str::slug($name, '-'));
        $candidate = $base;
        $suffix = 1;

        while (RfidReader::where('device_id', $candidate)->exists()) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }
}
