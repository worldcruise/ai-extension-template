from scrapers import jobright
from scrapers import simplify
from scrapers import zapplyjobs
from scrapers import speedyapply

SOURCES = {
    "jobright": {
        "label": "JobRight",
        "sync": jobright.sync_jobs,
    },
    "simplify": {
        "label": "Simplify",
        "sync": simplify.sync_jobs,
    },
    "zapplyjobs": {
        "label": "Zapply",
        "sync": zapplyjobs.sync_jobs,
    },
    "speedyapply": {
        "label": "SpeedyApply",
        "sync": speedyapply.sync_jobs,
    },
}
