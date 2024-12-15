#!/bin/sh

# Start the VHS server
vhs cassette.tape &

# Wait 2 seconds before running the first curl command
sleep 4

# Execute the first curl command
curl localhost:3000/users/U062UG485EE

# Wait 3 seconds before running the second curl command
sleep 2

curl localhost:3000/emojis/grolf/

sleep 3

curl localhost:3000/emojis/this-does-not-exist/

wait
