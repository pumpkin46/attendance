"""Application package initialization.

Silence one noisy third-party FutureWarning: insightface 1.0.1 calls
scikit-image's ``SimilarityTransform.estimate`` API, which scikit-image 0.26
deprecated. The call still works correctly; this only quiets the per-inference
log spam. Remove this once insightface adopts the new ``from_estimate``
constructor (or pin ``scikit-image<0.26`` in requirements for a durable fix).
"""

import warnings

warnings.filterwarnings(
    "ignore",
    message=r".*estimate.*deprecated since version 0\.26.*",
    category=FutureWarning,
)
