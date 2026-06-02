<?php

namespace App\Notifications;

use App\Models\SecurityAlert;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class SecurityAlertRaised extends Notification
{
    use Queueable;

    public function __construct(public readonly SecurityAlert $alert) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'security_alert',
            'alert_id' => $this->alert->id,
            'alert_type' => $this->alert->alert_type,
            'severity' => $this->alert->severity,
            'title' => $this->alert->title,
            'message' => $this->alert->message,
            'occurred_at' => $this->alert->occurred_at?->toIso8601String(),
        ];
    }
}
