const net = require('net');
const fs = require('fs');

// Define the server's hostname and port
const HOSTNAME = 'localhost';
const PORT = 3000;

const MISSED_FETCHING = 'FETCHING';
const MISSED_FETCHED = 'FETCHED';

let expectedSequence = 1;                   //chek if missing seq
let missedSequences = [];                  //which seq missed
let missedSequencesState;                 //missed seq fetching or fetched
let stockDataOp = [];                    //final output

// Create a new socket
let clientSocket = new net.Socket();

//handle output json
function handleOutput() {
  if(stockDataOp.length < 1){
    return;
  }
  //stringify the output array
  const jsonData = JSON.stringify(stockDataOp, null, 2);

  //write the output to a file
  fs.writeFile('stockData.json', jsonData, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log('Data written to stockData.json');
    }
  });
}

// Function to send a request
function sendRequest(callType, resendSeq = 0) {
  const payload = Buffer.alloc(2); // 2 bytes for callType and resendSeq
  payload.writeUInt8(callType, 0); // Set callType
  payload.writeUInt8(resendSeq, 1); // Set resendSeq

  clientSocket.write(payload);
}

// request all packets
function getAll() {
  connectServer();
  
  console.log('Fetching all packets');
  sendRequest(1);
}

//request missing packets
function getMissing() {
  //connect to server
  connectServer();
  console.log(`Missing sequences: ${missedSequences}`);
  console.log('Getting missing packets');

  //request missing sequences
  while (ismissedPackets()) {
    const sequence = missedSequences.pop();
    sendRequest(2, sequence); // 2 for "Resend Packet"
  }
  //close connection
  closeConnection();
}

//check if any sequences missed
function ismissedPackets() {
  return missedSequences.length > 0;
}

//connect to server
function connectServer() {
  clientSocket.connect(PORT, HOSTNAME, () => {
    console.log(`Connected to ${HOSTNAME}:${PORT}`);
  });
}

//close connection to server
function closeConnection() {
  clientSocket.end();
}

//parse the response
function parseResponse(data) {
  // Assuming each packet is 17 bytes long
  const packetSize = 17;
  for (let i = 0; i < data.length; i += packetSize) {
    const packet = data.slice(i, i + packetSize);

    // Extract fields from the packet
    const symbol = packet.toString('ascii', 0, 4);
    const buySellIndicator = packet.toString('ascii', 4, 5);
    const quantity = packet.readUInt32BE(5);
    const price = packet.readUInt32BE(9);
    const packetSequence = packet.readUInt32BE(13);

    const parsedPacket = {
      symbol,
      buySellIndicator,
      quantity,
      price,
      packetSequence
    }

    //console.log(`Received Packet: ${symbol}, ${buySellIndicator}, Quantity: ${quantity}, Price: ${price}, Sequence: ${packetSequence}`);

    // Check for missing sequences
    if (packetSequence !== expectedSequence) {
      for (let i = expectedSequence; i < packetSequence; i++) {
        missedSequences.push(i);
        stockDataOp.push(i);
      }
    }
    //if fetching missing sequences push at designated place else push at end 
    if (missedSequencesState == MISSED_FETCHING) {
      stockDataOp[packetSequence - 1] = parsedPacket;
    }
    else {
      stockDataOp.push(parsedPacket);
    }
    expectedSequence = packetSequence + 1;
  }
}

//handle recieved data
clientSocket.on('data', (data) => {
  parseResponse(data);
});

// Handle errors
clientSocket.on('error', (err) => {
  console.error(`Socket error: ${err}`);
});

// Handle connection close
clientSocket.on('close', () => {
  console.log('Connection closed');
  if (ismissedPackets()) {
    missedSequencesState = MISSED_FETCHING;
    getMissing();
  }
  else {
    missedSequencesState = MISSED_FETCHED;
    handleOutput();
  }
});

//request all packets initially
getAll();
