"""Application logging configuration.

Without this, the app's ``logger.info(...)`` calls propagate to a handler-less
root logger and are dropped — only WARNING+ leak out via the last-resort
handler, unformatted. ``setup_logging()`` installs a single formatted stdout
handler at ``settings.log_level`` so operational logs are actually visible.
"""

from __future__ import annotations

import logging
from logging.config import dictConfig

from app.core.config import settings

_configured = False


def setup_logging() -> None:
    """Idempotently configure root logging from settings.log_level."""
    global _configured
    if _configured:
        return

    level = settings.log_level.upper()
    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": "%(asctime)s %(levelname)-8s %(name)s: %(message)s",
                    "datefmt": "%Y-%m-%d %H:%M:%S",
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {"handlers": ["console"], "level": level},
            "loggers": {
                # Uvicorn ships its own handlers; let them flow through ours
                # instead so formatting is consistent and not duplicated.
                "uvicorn": {"handlers": ["console"], "level": level, "propagate": False},
                "uvicorn.access": {
                    "handlers": ["console"],
                    "level": level,
                    "propagate": False,
                },
            },
        }
    )
    _configured = True
    logging.getLogger(__name__).debug("Logging configured at level %s", level)
