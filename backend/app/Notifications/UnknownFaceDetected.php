<?php

namespace App\Notifications;

use App\Models\RecognitionEvent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class UnknownFaceDetected extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly RecognitionEvent $event) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $camera = $this->event->camera?->name ?? 'Unknown camera';
        $confidence = $this->event->confidence !== null
            ? round((float) $this->event->confidence * 100, 1).'%'
            : 'N/A';

        return (new MailMessage)
            ->subject('Unknown face detected')
            ->line('An unrecognized person was detected at '.$camera.'.')
            ->line('Confidence: '.$confidence)
            ->line('Time: '.$this->event->recognized_at->toDateTimeString())
            ->action('Review in dashboard', url('/unknown-faces'));
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'unknown_face',
            'recognition_event_id' => $this->event->id,
            'camera_id' => $this->event->camera_id,
            'camera_name' => $this->event->camera?->name,
            'confidence' => $this->event->confidence,
            'recognized_at' => $this->event->recognized_at->toIso8601String(),
            'snapshot_path' => $this->event->snapshot_path,
            'message' => 'Unknown face detected'.($this->event->camera ? ' at '.$this->event->camera->name : ''),
        ];
    }
}
