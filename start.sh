#!/bin/bash

# Initialize the index before starting anything
python -c 'from main import ensure_index_exists; ensure_index_exists()'

# Function to handle termination signals
cleanup() {
    echo "Stopping scheduler..."
    pkill -f scheduler.py  # Send SIGTERM to the scheduler process
    echo "Stopping Gunicorn..."
    pkill -f gunicorn  # Send SIGTERM to the Gunicorn process
    wait
    echo "All processes stopped."
}

# Trap SIGTERM and SIGINT to clean up background processes
trap cleanup SIGTERM SIGINT

# Start the scheduler in the background and redirect its logs
python scheduler.py >> scheduler.log 2>&1 &

# Start the Gunicorn server
exec gunicorn -w 4 -b 0.0.0.0:5000 main:app

# Wait for all background processes to finish (if any)
wait
