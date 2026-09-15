#!/usr/bin/env python3
"""
Python script for downloading data from the NASA CMR API

Requirements:
    > pip install tqdm earthaccess requests

Credentials are picked up by earthaccess in its usual order: ``~/.netrc``
first, then ``EARTHDATA_USERNAME`` / ``EARTHDATA_PASSWORD``, then an
interactive prompt. For unattended runs create ``~/.netrc`` containing::

    machine urs.earthdata.nasa.gov login <user> password <pass>

and ``chmod 600 ~/.netrc``.

To run the script: `python download.py`
Optional environment overrides:
    FLDAS_TEMPORAL   e.g. "1993-01-01,2026-12-31"  (default below)
    FLDAS_DOWNLOAD_DIR   where the NetCDF files are written
    MAX_WORKERS      parallel downloads (default 5)
"""

import os
import requests
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
import earthaccess

CMR_BASE_URL = "https://cmr.earthdata.nasa.gov"

SHORT_NAME = "FLDAS_NOAH01_C_GL_M"
VERSION = "001"
# Extended past the original 1993-2019 window: the app's date range runs to the
# present, and the previous table was missing 2020 onwards. CMR simply returns
# whatever months exist, so a future end date keeps this current.
FILTER_TEMPORAL = os.environ.get("FLDAS_TEMPORAL", "1993-01-01,2026-12-31")
FILTER_BBOX = "-20,-37,60,37"
FILTER_SEARCH = ""
FILTER_CLOUD_COVER_MIN = ""
FILTER_CLOUD_COVER_MAX = ""
DOWNLOAD_DIR = os.environ.get("FLDAS_DOWNLOAD_DIR", f"./{SHORT_NAME}_{VERSION}")
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "5"))  # Number of parallel downloads

os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def get_session():
    """Return an authenticated requests session for data downloads."""
    auth = earthaccess.login(strategy="all", persist=False)
    if not getattr(auth, "authenticated", True):
        raise SystemExit(
            "Earthdata login failed.\n"
            "Create ~/.netrc containing:\n"
            "  machine urs.earthdata.nasa.gov login <user> password <pass>\n"
            "(chmod 600 ~/.netrc), or set EARTHDATA_USERNAME and EARTHDATA_PASSWORD."
        )
    return earthaccess.get_requests_https_session()


def query_cmr_granules(
    short_name: str,
    version: str,
    page_size: int = 2000,
    search_after: str | None = None,
    **extra_params,
):
    """
    Queries the CMR granules endpoint.

    Args:
        short_name: The short name of the collection
        version: The version of the collection
        page_size: The number of results per page (max is 2000)
        search_after: The pagination token for subsequent requests (optional, see https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html#search-after for more details)
        **extra_params: Additional query parameters (e.g., temporal, bounding_box, etc.)

    Returns:
        tuple: (response object, list of granule items)
    """
    url = f"{CMR_BASE_URL}/search/granules.umm_json"

    params = {
        "short_name": short_name,
        "version": version,
        "page_size": page_size,
        **extra_params,  # Merge any additional parameters
    }

    headers = {"Accept": "application/json"}
    if search_after:
        headers["CMR-Search-After"] = search_after

    # CMR search API is public; use bare requests, not the auth session
    response = requests.get(url, params=params, headers=headers)

    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError:
        print("Failed to fetch granules:", response.text)
        raise

    data = response.json()
    items = data.get("items", [])

    return response, items


def download_data_from_cmr(
    short_name: str, version: str, total_granules: int, page_size: int = 2000, **params
):
    """Fetches granules for a given collection from the CMR API, then downloads the data from the "GET DATA" URLs"""
    search_after_value: str | None = None
    all_download_urls = []
    granules_without_urls = 0

    # First pass: collect all download URLs
    print("Collecting download URLs...")
    with tqdm(total=total_granules, desc="Collecting URLs", unit="granule") as pbar:
        while True:
            # Use shared query function
            response, items = query_cmr_granules(
                short_name, version, page_size, search_after_value, **params
            )

            # Collect "GET DATA" URLs
            for item in items:
                pbar.update(1)  # Update progress for each granule processed
                download_urls = []
                for related_url in item.get("umm", {}).get("RelatedUrls", []):
                    if related_url.get("Type") == "GET DATA":
                        download_urls.append(related_url.get("URL"))
                
                if download_urls:
                    all_download_urls.extend(download_urls)
                else:
                    granules_without_urls += 1

            # Read the next search-after value from response headers
            search_after_value = response.headers.get("CMR-Search-After")

            # There is no next search-after value, we've reached the end
            if not search_after_value:
                break

    print(f"Found {len(all_download_urls)} files to download")
    if granules_without_urls > 0:
        print(f"⚠️ {granules_without_urls} granules have no download URLs")

    # Second pass: download all files in parallel
    downloaded_count = 0
    skipped_count = 0
    failed_count = 0
    
    sess = get_session()
    
    with tqdm(total=len(all_download_urls), desc="Downloading files", unit="file") as pbar:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # Submit all download tasks at once
            future_to_url = {executor.submit(download_file, url, sess): url for url in all_download_urls}
            
            # Process completed downloads as they finish
            for future in as_completed(future_to_url):
                status, filename = future.result()
                if status == "success":
                    downloaded_count += 1
                    pbar.set_description(f"Downloaded: {filename}")
                elif status == "skipped":
                    skipped_count += 1
                    pbar.set_description(f"Skipped: {filename}")
                else:  # failed
                    failed_count += 1
                    print(f"Failed: {filename}")
                
                pbar.update(1)

    print(f"Downloaded: {downloaded_count} files")
    if skipped_count > 0:
        print(f"Skipped: {skipped_count} files (already exist)")
    if failed_count > 0:
        print(f"Failed: {failed_count} files")


def download_file(url: str, session: requests.Session | None = None):
    """Download a single file and return (success, skipped, failed) status and filename"""
    local_filename = os.path.join(DOWNLOAD_DIR, os.path.basename(url))
    if os.path.exists(local_filename):
        return "skipped", os.path.basename(url)  # skip existing

    if session is None:
        session = get_session()

    try:
        with session.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(local_filename, "wb") as f:
                for chunk in r.iter_content(8192):
                    f.write(chunk)
        return "success", os.path.basename(url)
    except Exception as e:
        print(f"⚠️ Error downloading {os.path.basename(url)}: {e}")
        return "failed", os.path.basename(url)


def fetch_total_granules_count_from_cmr(short_name: str, version: str, **params):
    """Fetches the total number of granules for a given collection and filters from the CMR API"""
    response, _ = query_cmr_granules(short_name, version, page_size=1, **params)
    data = response.json()
    return data.get("hits", 0)


def main():
    """Main function to download data from the CMR API"""
    global FILTER_TEMPORAL

    import argparse

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--temporal", default=FILTER_TEMPORAL,
                    help=f'CMR temporal range (default "{FILTER_TEMPORAL}")')
    ap.add_argument("--list-only", action="store_true",
                    help="report what would be downloaded and exit (no files, no login)")
    args = ap.parse_args()

    FILTER_TEMPORAL = args.temporal

    filter_params = {}

    if FILTER_TEMPORAL:
        filter_params["temporal"] = FILTER_TEMPORAL

    if FILTER_BBOX:
        filter_params["bounding_box"] = FILTER_BBOX

    if FILTER_SEARCH:
        filter_params["producer_granule_id[]"] = FILTER_SEARCH
        filter_params["options[producer_granule_id][pattern]"] = 'true'

    if FILTER_CLOUD_COVER_MIN and FILTER_CLOUD_COVER_MAX:
        filter_params["cloud_cover"] = f"{FILTER_CLOUD_COVER_MIN},{FILTER_CLOUD_COVER_MAX}"

    total_granules = fetch_total_granules_count_from_cmr(
        SHORT_NAME, VERSION, **filter_params
    )
    print(f"Total granules: {total_granules:,}")

    if args.list_only:
        _, items = query_cmr_granules(SHORT_NAME, VERSION, page_size=2000, **filter_params)
        sizes = [float(i.get("umm", {}).get("DataGranule", {})
                       .get("ArchiveAndDistributionSize", 0) or 0) for i in items]
        if any(sizes):
            print(f"Approximate download size: {sum(sizes) / 1024:.1f} GiB")
        print(f"Destination: {os.path.abspath(DOWNLOAD_DIR)}")
        print("Nothing downloaded (--list-only).")
        return

    download_data_from_cmr(SHORT_NAME, VERSION, total_granules, **filter_params)

    print("✅ All downloads complete.")


if __name__ == "__main__":
    main()
