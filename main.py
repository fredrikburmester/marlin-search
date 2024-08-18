import os
import uuid
import requests
import schedule
import time
from flask import Flask, request, jsonify
from meilisearch import Client, errors  # Correctly import errors

# Load environment variables
JELLYFIN_URL = os.getenv('JELLYFIN_URL')
JELLYFIN_API_KEY = os.getenv('JELLYFIN_API_KEY')
MEILISEARCH_URL = os.getenv('MEILISEARCH_URL')
MEILISEARCH_API_KEY = os.getenv('MEILISEARCH_API_KEY')
SCRAPE_INTERVAL_HOURS = int(os.getenv('SCRAPE_INTERVAL_HOURS', 1))

# Initialize MeiliSearch client
client = Client(MEILISEARCH_URL, MEILISEARCH_API_KEY)
index_name = 'jellyfin_items'

def ensure_index_exists():
    try:
        index = client.get_index(index_name)
    except errors.MeilisearchApiError as e:
        if "index_not_found" in str(e):
            # Create the index if it does not exist
            client.create_index(index_name, {'primaryKey': 'Id'})
            index = client.index(index_name)
            print(f"Index `{index_name}` created.")
        else:
            raise e
    
    index.update_filterable_attributes(['Type'])
    return index

index = ensure_index_exists()

# Flask app for API
app = Flask(__name__)

def scrape_jellyfin():
    headers = {
        'X-Emby-Token': JELLYFIN_API_KEY,
    }

    response = requests.get(JELLYFIN_URL + "/Items?Recursive=true", headers=headers)
    
    try:
        response_data = response.json()
    except requests.exceptions.JSONDecodeError:
        print(f"Failed to decode JSON response: {response.text}")
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
        print(f"Added {len(documents)} items to MeiliSearch.")
        return {"status": "success", "message": f"Added {len(documents)} items to MeiliSearch."}, 200
    else:
        print(f"Failed to fetch items: {response.status_code}")
        return {"status": "error", "message": f"Failed to fetch items: {response.status_code}"}, 500


# Schedule the scrape function to run every SCRAPE_INTERVAL_HOURS
schedule.every(SCRAPE_INTERVAL_HOURS).hours.do(scrape_jellyfin)

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
    # Run the scheduler in a background thread
    def run_scheduler():
        while True:
            schedule.run_pending()
            time.sleep(1)

    from threading import Thread
    scheduler_thread = Thread(target=run_scheduler)
    scheduler_thread.daemon = True
    scheduler_thread.start()

    # Start the Flask API
    app.run(host='0.0.0.0', port=5000)
