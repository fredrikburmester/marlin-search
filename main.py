import os
import requests
from flask import Flask, request, jsonify
from meilisearch import Client, errors
import logging
from logging.handlers import RotatingFileHandler
import time
from flask.logging import default_handler

# Load environment variables
JELLYFIN_URL = os.getenv('JELLYFIN_URL')
JELLYFIN_API_KEY = os.getenv('JELLYFIN_API_KEY')
MEILISEARCH_URL = os.getenv('MEILISEARCH_URL')
MEILISEARCH_API_KEY = os.getenv('MEILISEARCH_API_KEY')
SCRAPE_INTERVAL_MINUTES = int(os.getenv('SCRAPE_INTERVAL_MINUTES', 60))

# Initialize MeiliSearch client
client = Client(MEILISEARCH_URL, MEILISEARCH_API_KEY)
INDEX_NAME = 'jellyfin_items'

# Flask app for API
app = Flask(__name__)

def setup_logging():
    """Configure logging for the Flask app."""
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    formatter = logging.Formatter(
        '[%(asctime)s] [%(levelname)s] in %(module)s: %(message)s',
        '%Y-%m-%d %H:%M:%S'
    )

    file_handler = RotatingFileHandler('app.log', maxBytes=10*1024*1024, backupCount=5)
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    app.logger.handlers = logger.handlers
    app.logger.setLevel(logger.level)
    app.logger.removeHandler(default_handler)

if __name__ != '__main__':
    setup_logging()

def ensure_index_exists():
    """
    Ensure that an index exists in MeiliSearch with the name INDEX_NAME. 
    If it does not exist, create it.
    """
    try:
        index = client.get_index(INDEX_NAME)
        app.logger.info(f"Index `{INDEX_NAME}` already exists.")
    except errors.MeilisearchApiError as e:
        if "index_not_found" in str(e):
            try:
                client.create_index(INDEX_NAME, {'primaryKey': 'Id'})
                index = client.index(INDEX_NAME)
                app.logger.info(f"Index `{INDEX_NAME}` created successfully.")
            except errors.MeilisearchApiError as create_error:
                app.logger.error(f"Failed to create index: {str(create_error)}")
                raise
        else:
            app.logger.error(f"Unexpected error when getting index: {str(e)}")
            raise

    try:
        index.update_filterable_attributes(['Type'])
        app.logger.info("Updated filterable attributes.")
    except errors.MeilisearchApiError as e:
        app.logger.error(f"Failed to update filterable attributes: {str(e)}")
        raise

    return index

def scrape_jellyfin():
    """
    Scrape Jellyfin for items and update the MeiliSearch index with these items.
    """
    headers = {
        'X-Emby-Token': JELLYFIN_API_KEY,
    }

    try:
        response = requests.get(f"{JELLYFIN_URL}/Items?Recursive=true", headers=headers, timeout=30)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Failed to fetch items from Jellyfin: {str(e)}")
        return {"status": "error", "message": f"Failed to fetch items from Jellyfin: {str(e)}"}, 500

    try:
        response_data = response.json()
    except ValueError:
        app.logger.error(f"Failed to decode JSON response: {response.text}")
        return {"status": "error", "message": "Invalid JSON response from Jellyfin"}, 500

    items = response_data.get('Items', [])
    allowed_types = {"Movie", "Series", "Episode", "MusicArtist", "MusicAlbum", "Audio"}
    
    documents = [
        {
            'Id': item.get('Id'),
            'Name': item.get('Name'),
            'Type': item.get('Type'),
            'CollectionType': item.get('CollectionType', 'unknown'),
            'MediaType': item.get('MediaType'),
            'IsFolder': item.get('IsFolder'),
            'Container': item.get('Container'),
            'PremiereDate': item.get('PremiereDate'),
            'CommunityRating': item.get('CommunityRating'),
            'ProductionYear': item.get('ProductionYear'),
            'ParentIndexNumber': item.get('ParentIndexNumber'),
            'SeriesName': item.get('SeriesName'),
            'SeasonName': item.get('SeasonName'),
            'VideoType': item.get('VideoType'),
        }
        for item in items
        if item.get('Type') in allowed_types
    ]
    
    try:
        index = client.get_index(INDEX_NAME)
        index.add_documents(documents)
        app.logger.info(f"Added {len(documents)} items to MeiliSearch.")
        return {"status": "success", "message": f"Added {len(documents)} items to MeiliSearch."}, 200
    except errors.MeilisearchApiError as e:
        app.logger.error(f"Failed to add documents to MeiliSearch: {str(e)}")
        return {"status": "error", "message": f"Failed to add documents to MeiliSearch: {str(e)}"}, 500

@app.route('/search', methods=['GET'])
def search_items():
    query = request.args.get('q', '')
    include_item_types = request.args.getlist('includeItemTypes')

    if not query:
        return jsonify({"error": "No query provided"}), 400

    filter_query = " OR ".join(f"Type = '{item_type}'" for item_type in include_item_types) if include_item_types else ""

    try:
        index = client.get_index(INDEX_NAME)
        search_results = index.search(query, {'filter': filter_query} if filter_query else {})
        ids = [hit['Id'] for hit in search_results['hits']]
        return jsonify({"ids": ids})
    except errors.MeilisearchApiError as e:
        app.logger.error(f"MeiliSearch error during search: {str(e)}")
        return jsonify({"error": "An error occurred during the search"}), 500

@app.route('/index', methods=['POST'])
def trigger_scrape():
    start_time = time.time()
    status, code = scrape_jellyfin()
    elapsed_time = time.time() - start_time
    app.logger.info(f"Scrape completed in {elapsed_time:.2f} seconds")
    return jsonify(status), code

@app.route('/clear', methods=['POST'])
def clear_index():
    try:
        index = client.get_index(INDEX_NAME)
        index.delete_all_documents()
        app.logger.info("Index cleared successfully.")
        return jsonify({"status": "success", "message": "Index cleared successfully."}), 200
    except errors.MeilisearchApiError as e:
        app.logger.error(f"Failed to clear index: {str(e)}")
        return jsonify({"status": "error", "message": f"Failed to clear index: {str(e)}"}), 500

if __name__ == '__main__':
    app.logger.info("Starting Flask app.")
    app.run(host='0.0.0.0', port=5000)