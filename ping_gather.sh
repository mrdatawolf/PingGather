#!/bin/bash

# Function to generate a random string
generate_random_string() {
    tr -dc A-Za-z0-9 </dev/urandom | head -c 4
}

# Function to log ping results
log_ping_result() {
    local ip=$1
    local datetime=$2
    local latency=$3
    echo "$COMPUTER_NAME,$DOMAIN,$ip,$datetime,$latency" >> "$RESULT_FILE_PATH"
}

# Function to ping an IP address
ping_ip() {
    local ip=$1
    local datetime=$(date +"%Y-%m-%d %H:%M:%S")
    local ping_result=$(ping -c 1 -W 1 $ip 2>/dev/null)
    if [ $? -ne 0 ]; then
        local latency=1001
    else
        local latency=$(echo "$ping_result" | grep 'time=' | sed -E 's/.*time=([0-9.]+) ms/\1/')
        if [ -z "$latency" ]; then
            latency=1001
        fi
    fi
    log_ping_result $ip $datetime $latency
}

# Parameters
DESTINATION_IPS=("$@")
RESULT_FILE_PATH=""
SLEEP_INTERVAL=5
LOG_DIR="./logs"

# Get the computer name and date stamp
COMPUTER_NAME=$(hostname)
DATE_STAMP=$(date +"%Y%m%d")
DOMAIN=$(hostname -d)

# Create log directory if it doesn't exist
mkdir -p $LOG_DIR

# Set the result file path if not specified
if [ -z "$RESULT_FILE_PATH" ]; then
    RESULT_FILE_PATH="$LOG_DIR/result_${COMPUTER_NAME}_${DATE_STAMP}_$(generate_random_string).csv"
fi

echo "Writing results to $RESULT_FILE_PATH."

# Infinite loop to ping the IPs and log the results
while true; do
    for IP in "${DESTINATION_IPS[@]}"; do
        ping_ip $IP
    done
    sleep $SLEEP_INTERVAL
done