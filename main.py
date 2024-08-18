import os
import requests
from flask import Flask, request, jsonify
from meilisearch import Client, errors
import logging

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
app.logger.setLevel(logging.INFO)

handler = logging.StreamHandler()
handler.setLevel(logging.INFO)
app.logger.addHandler(handler)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def ensure_index_exists():
    """
    Ensure that an index exists in MeiliSearch with the name INDEX_NAME. 
    If it does not exist, create it.
    """
    try:
        index = client.get_index(INDEX_NAME)
    except errors.MeilisearchApiError as e:
        if "index_not_found" in str(e):
            # Create the index if it does not exist
            client.create_index(INDEX_NAME, {'primaryKey': 'Id'})
            index = client.index(INDEX_NAME)
            logging.info(f"Index `{INDEX_NAME}` created.")
        else:
            raise e

    index.update_filterable_attributes(['Type'])
    return index

index = ensure_index_exists()

def scrape_jellyfin():
    """
    Scrape Jellyfin for items and update the MeiliSearch index with these items.
    """
    headers = {
        'X-Emby-Token': JELLYFIN_API_KEY,
    }

    response = requests.get(JELLYFIN_URL + "/Items?Recursive=true", headers=headers)
    
    try:
        response_data = response.json()
    except requests.exceptions.JSONDecodeError:
        logging.error(f"Failed to decode JSON response: {response.text}")
        return {"status": "error", "message": "Invalid JSON response from Jellyfin"}, 500

    if response.status_code == 200:
        items = response_data.get('Items', [])
        
        # List of types to index
        allowed_types = {"Movie", "Series", "Episode", "MusicArtist", "MusicAlbum", "Audio"}
        
        # Prepare items for MeiliSearch by filtering and flattening the structure
        documents = []
        for item in items:
            if item.get('Type') in allowed_types:
                document = {
                    'Id': item.get('Id', None),
                    'Name': item.get('Name', None),
                    'Type': item.get('Type', None),
                    'CollectionType': item.get('CollectionType', 'unknown'),
                    'MediaType': item.get('MediaType', None),
                    'IsFolder': item.get('IsFolder', None),
                    'Container': item.get('Container', None),
                    'PremiereDate': item.get('PremiereDate', None),
                    'CommunityRating': item.get('CommunityRating', None),
                    'ProductionYear': item.get('ProductionYear', None),
                    'ParentIndexNumber': item.get('ParentIndexNumber', None),
                    'SeriesName': item.get('SeriesName', None),
                    'SeasonName': item.get('SeasonName', None),
                    'VideoType': item.get('VideoType', None),
                }
                documents.append(document)
        
        # Store items in MeiliSearch
        index.add_documents(documents)
        logging.info(f"Added {len(documents)} items to MeiliSearch.")
        return {"status": "success", "message": f"Added {len(documents)} items to MeiliSearch."}, 200
    else:
        logging.error(f"Failed to fetch items: {response.status_code}")
        return {"status": "error", "message": f"Failed to fetch items: {response.status_code}"}, 500

@app.route('/search', methods=['GET'])
def search_items():
    query = request.args.get('q', '')
    include_item_types = request.args.getlist('includeItemTypes')  # Get the list of types to include

    filter_query = ""
    if include_item_types:
        # Create a filter query for MeiliSearch that includes only the specified item types
        type_filters = [f"Type = '{item_type}'" for item_type in include_item_types]
        filter_query = " OR ".join(type_filters)

    if query:
        # Pass the filter query to MeiliSearch if it's not empty
        search_results = index.search(query, {'filter': filter_query} if filter_query else {})
        ids = [hit['Id'] for hit in search_results['hits']]
        return jsonify({"ids": ids})
    else:
        return jsonify({"error": "No query provided"}), 400

@app.route('/index', methods=['POST'])
def trigger_scrape():
    status, code = scrape_jellyfin()
    return jsonify(status), code

@app.route('/clear', methods=['POST'])
def clear_index():
    try:
        index.delete_all_documents()
        return jsonify({"status": "success", "message": "Index cleared successfully."}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    logging.info("Starting Flask app.")
    app.run(host='0.0.0.0', port=5000)
