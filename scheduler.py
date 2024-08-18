import schedule
import time
import logging
from main import SCRAPE_INTERVAL_MINUTES, scrape_jellyfin  # Assuming main.py is where your function is

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Schedule the scrape function
schedule.every(SCRAPE_INTERVAL_MINUTES).minutes.do(scrape_jellyfin)

def run_scheduler():
    logging.info("Scheduler started.")
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    run_scheduler()
