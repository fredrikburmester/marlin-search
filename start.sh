#!/bin/bash

# Start the scheduler in the background
python scheduler.py &

# Start the Gunicorn server
exec gunicorn -w 4 -b 0.0.0.0:5000 main:app
