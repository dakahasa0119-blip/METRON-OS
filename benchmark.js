const fs = require('fs');
const source = fs.readFileSync('modules/gas/METRON_OS_B/Communication_Manager.js', 'utf8');

// A simple mock for GAS
global.SpreadsheetApp = {
    getActive: () => ({ getId: () => '123' }),
    openById: () => ({
        getSheetByName: (name) => {
            if (name === "Dispatcher") {
                return {
                    getDataRange: () => ({ getValues: () => [['from', 'to', 'type', 'payload', 'timestamp']] }),
                    appendRow: () => {}
                };
            }
            if (['METRON-A', 'METRON-B', 'METRON-C'].includes(name)) {
                return {
                    getDataRange: () => ({
                        getValues: () => {
                            let rows = [['from', 'type', 'payload', 'timestamp', 'UNPROCESSED']];
                            for(let i=0; i<1000; i++) {
                                rows.push([`from-${i}`, `type`, `payload`, `time`, 'UNPROCESSED']);
                            }
                            return rows;
                        }
                    }),
                    getRange: (r, c, nr, nc) => ({
                        setValue: (v) => {},
                        setValues: (v) => {}
                    })
                };
            }
            return null;
        }
    })
};

global.Strategic_AI = {
    process: () => ({type: 'ACK', payload: 'ok', to: 'METRON-A'})
};

global.buildMotherShipContext = () => ({});

eval(source);

const start = process.hrtime.bigint();
processMotherShipMessages();
const end = process.hrtime.bigint();

console.log(`Execution time: ${Number(end - start) / 1000000} ms`);
