import io
import math
import re

import pdfplumber


def extract_chunks(content):
    chunks = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        if len(pdf.pages) > 300:
            raise ValueError("Please upload a manual with 300 pages or fewer.")
        count = len(pdf.pages)
        for number, page in enumerate(pdf.pages, 1):
            text = (page.extract_text() or "").strip()
            # Preserve adjacent lines and overlap within each source page.
            for start in range(0, len(text), 1000):
                chunk = text[start : start + 1200].strip()
                if chunk:
                    chunks.append({"page": number, "text": chunk})
            if len(chunks) > 2000:
                raise ValueError(
                    "This manual contains too much text. Split it into smaller files."
                )
    if not chunks:
        raise ValueError(
            "No readable text found. Scan-only PDFs need OCR before uploading."
        )
    return count, chunks


def cosine(a, b):
    if len(a) != len(b):
        return 0.0
    denominator = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / denominator if denominator else 0.0


def terms(text):
    return set(re.findall(r"[a-z0-9]{3,}", text.lower())) - {
        "the",
        "and",
        "for",
        "what",
        "how",
        "with",
        "this",
        "does",
        "from",
        "should",
        "check",
    }


DEMO_CHUNKS = [
    {
        "page": 4,
        "text": "Excessive vibration — illustrative training scenario. Possible causes include loose mounting, coupling misalignment, and bearing wear. Follow the approved site isolation procedure before inspection. Inspect mounting security, review alignment records, and compare bearing condition with the manufacturer’s limits. Do not infer a vibration limit from this example.",
    },
    {
        "page": 7,
        "text": "Overheating — illustrative training scenario. Check the recorded operating load, cooling airflow, and lubrication records against the actual manufacturer manual. Stop and escalate if limits are exceeded. Never remove guards or touch moving components during operation.",
    },
    {
        "page": 9,
        "text": "Preventive maintenance — illustrative training scenario. Record equipment identity, inspection date, observed symptoms, measurements, and the approved procedure used. Maintenance intervals, torque settings, and replacement parts must come from the actual equipment manual; none are specified in this sample.",
    },
]
