const assert = require('assert');

// Simple global mocks for testing
global.SpreadsheetApp = {};

const cm = require('../../../../modules/gas/METRON_OS_B/Communication_Manager.js');

describe('Communication_Manager - getMotherShipList', function() {
    let mockDataRange, mockSheet, mockSS, mockActive;

    beforeEach(function() {
        mockDataRange = {
            getValues: function() {}
        };
        mockSheet = {
            getDataRange: function() { return mockDataRange; }
        };
        mockSS = {
            getSheetByName: function(name) {
                if (name === "MotherShips") return mockSheet;
                return null;
            }
        };
        mockActive = {
            getId: function() { return 'test-id'; }
        };

        global.SpreadsheetApp.getActive = function() { return mockActive; };
        global.SpreadsheetApp.openById = function(id) { return mockSS; };
    });

    it('should return empty array if "MotherShips" sheet is not found', function() {
        mockSS.getSheetByName = function() { return null; };
        const result = cm.getMotherShipList();
        assert.deepStrictEqual(result, []);
    });

    it('should parse ships correctly skipping the header row', function() {
        mockDataRange.getValues = function() {
            return [
                ["Ship Name", "Status", "Last Seen"], // Header
                ["METRON-A", "Online", "2023-01-01"],
                ["METRON-B", "Online", "2023-01-02"],
                ["METRON-C", "Offline", "2023-01-03"]
            ];
        };
        const result = cm.getMotherShipList();
        assert.deepStrictEqual(result, ["METRON-A", "METRON-B", "METRON-C"]);
    });

    it('should ignore empty rows', function() {
        mockDataRange.getValues = function() {
            return [
                ["Ship Name"], // Header
                ["METRON-A"],
                [""],          // Empty
                ["METRON-B"],
                [null],        // null value
                [undefined],   // undefined
                ["METRON-C"]
            ];
        };
        const result = cm.getMotherShipList();
        assert.deepStrictEqual(result, ["METRON-A", "METRON-B", "METRON-C"]);
    });
});
