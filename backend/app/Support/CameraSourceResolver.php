<?php

namespace App\Support;

class CameraSourceResolver
{
    /** Infer recognition source from stream URL or explicit type. */
    public static function fromStreamUrl(?string $streamUrl, ?string $explicit = null): string
    {
        if ($explicit && in_array($explicit, config('recognition.supported_sources', []), true)) {
            return $explicit;
        }

        if (! $streamUrl) {
            return 'upload';
        }

        $url = strtolower(trim($streamUrl));

        if (str_starts_with($url, 'rtsp://') || str_contains($url, 'rtsp')) {
            return 'rtsp';
        }

        if (str_contains($url, '/nvr/') || str_contains($url, 'nvr')) {
            return 'nvr';
        }

        if (str_contains($url, 'cctv') || str_contains($url, 'onvif')) {
            return 'cctv';
        }

        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            return 'ip_camera';
        }

        if (str_starts_with($url, '/dev/video') || str_contains($url, 'usb')) {
            return 'usb_camera';
        }

        return 'ip_camera';
    }
}
