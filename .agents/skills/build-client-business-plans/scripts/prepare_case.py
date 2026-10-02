#!/usr/bin/env python3
"""Create editable client working copies from the bundled templates."""

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
from datetime import date
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.sax.saxutils import escape


ASSETS = {
    "Business Plan Draft.docx": "business-plan-template.docx",
    "Financial Forecast Draft.xlsx": "financial-forecast-template.xlsx",
    "Client Intake.docx": "client-intake-template.docx",
}


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]+", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if not cleaned:
        raise ValueError("Client name must contain at least one usable character")
    return cleaned[:100]


def replace_docx_identity(path: Path, business_name: str, produced_date: str) -> None:
    """Populate identity placeholders without changing the document's styles."""
    replacements = {
        b"[Business name]": escape(business_name).encode("utf-8"),
        b"[YYYY-MM-DD]": produced_date.encode("utf-8"),
    }
    with tempfile.NamedTemporaryFile(
        prefix=f"{path.stem}-", suffix=".docx", dir=path.parent, delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with ZipFile(path) as source, ZipFile(temporary_path, "w", ZIP_DEFLATED) as target:
            for item in source.infolist():
                data = source.read(item.filename)
                if item.filename.startswith("word/") and item.filename.endswith(".xml"):
                    for old, new in replacements.items():
                        data = data.replace(old, new)
                target.writestr(item, data)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def prepare(
    client_name: str,
    output_dir: Path,
    force: bool = False,
    produced_date: date | None = None,
) -> list[Path]:
    skill_dir = Path(__file__).resolve().parent.parent
    asset_dir = skill_dir / "assets"
    client = safe_name(client_name)
    date_text = (produced_date or date.today()).isoformat()
    case_dir = output_dir.expanduser().resolve() / client
    case_dir.mkdir(parents=True, exist_ok=True)

    created: list[Path] = []
    for suffix, asset_name in ASSETS.items():
        source = asset_dir / asset_name
        suffix_path = Path(suffix)
        dated_suffix = f"{suffix_path.stem} - {date_text}{suffix_path.suffix}"
        destination = case_dir / f"{client} - {dated_suffix}"
        if not source.is_file():
            raise FileNotFoundError(f"Missing bundled asset: {source}")
        if destination.exists() and not force:
            raise FileExistsError(
                f"Refusing to overwrite {destination}. Use --force only when replacement is intended."
            )
        shutil.copy2(source, destination)
        if destination.suffix.lower() == ".docx":
            replace_docx_identity(destination, client_name, date_text)
        created.append(destination)
    return created


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy the business-plan skill templates into a client working folder."
    )
    parser.add_argument("client_name", help="Client or business name used in filenames")
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Parent directory for the client working folder",
    )
    parser.add_argument(
        "--date",
        dest="produced_date",
        type=date.fromisoformat,
        help="Production date in YYYY-MM-DD format; defaults to today's local date",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace existing client copies in the target folder",
    )
    args = parser.parse_args()

    for path in prepare(
        args.client_name,
        args.output_dir,
        force=args.force,
        produced_date=args.produced_date,
    ):
        print(path)


if __name__ == "__main__":
    main()
