--
-- Luup plugin for GE/Networx/Caddx NX-584/NX-8E security system interface.
--
-- Version 0.2 2011-04-27 by Deborah Pickett
-- * Panic modes (medical, fire, police)
-- * Uses Partition API 2
--
-- Version 0.1 2010-08-07 by Deborah Pickett
-- * Probes interface for valid partitions
-- * Sets interface clock
-- * Creates luup child devices for partitions and zones
-- * Tracks partitions' armed state (away/stay/disarmed/breached)
-- * Tracks zones' tripped state
-- * Tracks zones' bypass state
-- * Actions supported:
--   - bypass zone
--   - quick (one-touch) arm
--   - arm with PIN
--   - quick (one-touch) partial (away) arm
--   - partial (away) arm with PIN
--   - disarm with PIN
--

module ("L_CaddxNX584Security", package.seeall)

ALARM_SERVICEID = "urn:futzle-com:serviceId:CaddxNX584Security1"
ALARM_PARTITION_SERVICEID = "urn:micasaverde-com:serviceId:AlarmPartition1"
ALARM_ZONE_SERVICEID = "urn:micasaverde-com:serviceId:SecuritySensor1"

INCOMING_EXPECTING_START = 0	   -- Between messages
INCOMING_EXPECTING_LENGTH = 1	  -- Received start byte 0x7e
INCOMING_EXPECTING_TYPE = 2		-- Received length byte
INCOMING_EXPECTING_CHECKSUM1 = 3   -- Received all bytes, now need first checksum byte
INCOMING_EXPECTING_CHECKSUM2 = 4   -- Received first checksum byte
INCOMING_EXPECTING_MESSAGE = 5	 -- Receiving message body bytes

LOG_DEBUG = true -- Debug I/O with interface.
MAX_RETRIES = 3 -- This many failures indicates the system has failed.

--
-- Utility functions for bitwise operations.
--

-- Thanks to guessed for this snippet.
function findChild(deviceId, label)
	for k, v in pairs(luup.devices) do
		if (v.device_num_parent == deviceId and v.id == label) then
			return k
		end
	end
end

-- bitMask(val, pos)
-- Poor man's bitwise operation: return true if a bit is set, false if clear.
-- val: number from 0 to 255
-- pos: power of two, value of bit being tested
function bitMask(val, pos)
	return (val % (pos*2) >= pos)
end

-- bitAnd(a, b)
-- poor man's bitwise operation: AND of two bytes.
-- a, b: numbers 0-255 to compute the bitwise AND of
function bitAnd(a, b)
	local result = 0
	local pos = 1
	repeat
		if (bitMask(a, pos) and bitMask(b,pos)) then
			result = result + pos
		end
		pos = pos * 2
	until pos == 256
end


--
-- Initial setup
--

-- caddxInitialize(deviceId)
-- Initialize the interface:
-- - Check that the interface is configured to handle all the requests we may send.
-- - Get status of the alarm system.
-- - Get a list of valid partitions.
function caddxInitialize(deviceId)
	luup.log("Initializing Caddx NX-584")
	luup.io.intercept()

	-- Remember parent device ID.
	ROOT_DEVICE = deviceId;

	-- Incoming byte state machine initialization.
	RECEIVE_STATE = INCOMING_EXPECTING_START
	INCOMING_ESCAPED = 0x0
	CHECKSUM1 = 0
	CHECKSUM2 = 0
	LENGTH = 0

	-- Ask the alarm system if it's configured to be
	-- able to respond to the requests we'll give it.
	if (not setUpInterface(ROOT_DEVICE)) then
		luup.set_failure(true, ROOT_DEVICE)
		return false, "Failed to set up interface", "Caddx NX-584"
	end

	-- Set the clock on the interface.
	if (CAPABILITY_SET_CLOCK) then
		setInterfaceClock(ROOT_DEVICE)
	end

	-- Ask the alarm system about the global status.
	-- Includes: faults; 4- or 6-digit PIN; list of valid partitions.
	if (not getSystemStatus(ROOT_DEVICE)) then
		luup.set_failure(true, ROOT_DEVICE)
		return false, "Failed to get initial status", "Caddx NX-584"
	end

	-- Start enumerating child devices.
	local childDevices = luup.chdev.start(ROOT_DEVICE)

	-- Get information about each partition.
	PARTITION_STATUS = {}
	PARTITION_CONFIGURED = {}
	for partition, _ in pairs(PARTITION_VALID) do
		PARTITION_CONFIGURED[partition] = false
		PARTITION_STATUS[partition] = {}
	end
	repeat
		-- Do this until we are satisfied that we are done.
		-- This is complicated by the fact that the alarm system
		-- may send asynchronous events while we are learning its
		-- configuration.  Perversely, we may get an asynchronous
		-- message about partition x when we just asked about partition y.
		local done = true
		for partition, configured in pairs(PARTITION_CONFIGURED) do
			if (not configured) then
				if (LOG_DEBUG) then luup.log("Setting up partition " .. partition) end
				done = false
				if (setUpPartition(ROOT_DEVICE, childDevices, partition)) then
					PARTITION_CONFIGURED[partition] = true
				end
			end
		end
	until done == true

	-- Get information about each zone.
	ZONE_STATUS = {}
	ZONE_VALID = {}
	for zone = 1,48 do
		if (setUpZone(ROOT_DEVICE, childDevices, zone)) then
			ZONE_VALID[zone] = true
			ZONE_STATUS[zone] = { }
		end
	end

	-- Commit child devices.
	luup.chdev.sync(ROOT_DEVICE, childDevices)

	-- Set the initial states for each partition based on the
	-- information we've collected.
	for partition, _ in pairs(PARTITION_VALID) do
		updatePartitionDevice(ROOT_DEVICE, partition)
	end

	-- Set the initial states for each zone based on the
	-- information we've collected.
	for zone, _ in pairs(ZONE_VALID) do
		updateZoneDevice(ROOT_DEVICE, zone)
	end

	-- Scan result callbacks.
	ZONE_SCAN = {}
	USER_SCAN = {}
	luup.register_handler("callbackHandler", "GetConfiguration")
	luup.register_handler("callbackHandler", "ZoneScan")
	luup.register_handler("callbackHandler", "ZoneNameScan")
	luup.register_handler("callbackHandler", "UserScan")

	-- Setup is complete.  Prepare to finish initialization.
	if (LOG_DEBUG) then luup.log("Finished initialization") end

	-- These are the messages that we expect to get from the alarm system
	-- during normal operation.
	PERMANENT_HANDLERS = {
		[4] = handleZoneStatusMessage,
		[5] = handleZonesSnapshotMessage,
		[6] = handlePartitionStatusMessage,
		[7] = handlePartitionsSnapshotMessage,
		[8] = handleSystemStatusMessage,
		[10] = handleLogEventMessage,
	}
	TEMPORARY_HANDLERS = {}

	JOBS = {}
	JOBS_PENDING_SEND = {}
	JOBS_PENDING_SEND_HEAD = 1
	JOBS_PENDING_SEND_TAIL = 0
	
	-- Initializtion complete.
end

-- sendMessageAndHandleResponse(deviceId, message, handlers)
-- Send a message (message type + body encoded in a string)
-- to the alarm system, and wait for a message in response.
function sendMessageAndHandleResponse(deviceId, message, handlers)
	luup.io.intercept()
	local retries = 0
	repeat
		sendMessage(message)
		-- Get a full message.
		local a, b, c
		repeat
			local status
			status, a, b, c = readByte(luup.io.read(3, ROOT_DEVICE))
			if (status == 2) then
				-- Bad checksum.  Send a negative acknowledgment message.
				sendNegativeAcknowledgeMessage()
				retries = retries + 1
			end
		until (status == 4)
		if (handlers[a] ~= nil) then
			-- This is the message I am looking for.
			return handleMessage(ROOT_DEVICE, handlers, a, b, c)
		elseif (a == "timeout") then
			-- Timed out waiting for a response (e.g., during setup)
			if (LOG_DEBUG) then luup.log("Timed out waiting for response, retrying") end
			retries = retries + 1
		else
			-- This is a message I don't want.
			if (LOG_DEBUG) then luup.log(string.format("Received inconvenient message 0x%02x", a)) end
			if (LOG_DEBUG) then logMessage("Unsolicited message body:", b) end
			-- Implementation note: documentation says we should send
			-- sendMessageRejectedMessage() but that doesn't seem to placate
			-- the alarm system.
			if (c) then sendPositiveAcknowledgeMessage() end  -- Yes, dear.
		end
	until (retries == MAX_RETRIES)
	luup.set_failure(true)
	return false
end

-- setUpInterface(deviceId)
-- Get the configuration information about the alarm system.
-- Send an Interface Configuration Request 0x21,
-- and wait for the reply 0x01.  Reject any other messages
-- that may come in (e.g., zone status messages)
function setUpInterface(deviceId)
	if (LOG_DEBUG) then luup.log("Sending message and waiting for response: 0x21 Interface Configuration Request") end

	return sendMessageAndHandleResponse(ROOT_DEVICE, "\033", 
		{
			[1] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Handling message: 0x01 Interface Configuration") end

				-- Firmware version.
				if (LOG_DEBUG) then luup.log(string.format("Firmware version %s", string.sub(message, 1, 4))) end

				-- Check that the interface can respond to the message requests
				-- that we need.
				if (bitMask(string.byte(string.sub(message,5)), 2) -- 0x01
					and bitMask(string.byte(string.sub(message,5)), 16) -- 0x04
					and bitMask(string.byte(string.sub(message,5)), 32) -- 0x05
					and bitMask(string.byte(string.sub(message,5)), 64) -- 0x06
					and bitMask(string.byte(string.sub(message,5)), 128) -- 0x07
					and bitMask(string.byte(string.sub(message,6)), 1) -- 0x08
					and bitMask(string.byte(string.sub(message,7)), 2) -- 0x21
					and bitMask(string.byte(string.sub(message,7)), 16) -- 0x24
					and bitMask(string.byte(string.sub(message,7)), 32) -- 0x25
					and bitMask(string.byte(string.sub(message,7)), 64) -- 0x26
					and bitMask(string.byte(string.sub(message,7)), 128) -- 0x27
					and bitMask(string.byte(string.sub(message,8)), 1) -- 0x28
				) then
					luup.log("All message codes are supported.")
				else
					-- An essential message has been disabled.
					-- To do: signal failure.
				end

				-- Not all alarm systems know how to name zones; it depends
				-- on the keypads attached to the system.
				if (bitMask(string.byte(string.sub(message,7)), 8)) then
					luup.log("Zone Name enabled")
					CAPABILITY_ZONE_NAME = true
				end

				-- User Information Request with PIN
				-- Get a user's authorization and PIN
				if (bitMask(string.byte(string.sub(message,9)), 4)) then
					luup.log("Get User Information with PIN enabled")
					CAPABILITY_GET_USER_INFORMATION_WITH_PIN = true
				end

				-- Set User Code with PIN
				if (bitMask(string.byte(string.sub(message,9)), 16)) then
					luup.log("Set User Code with PIN enabled")
					CAPABILITY_SET_USER_CODE_WITH_PIN = true
				end

				-- Set User Authorization with PIN
				if (bitMask(string.byte(string.sub(message,9)), 64)) then
					luup.log("Set User Authorization with PIN enabled")
					CAPABILITY_SET_USER_AUTHORIZATION_WITH_PIN = true
				end

				-- Set Clock can be optionally disabled.
				if (bitMask(string.byte(string.sub(message,10)), 8)) then
					luup.log("Set Clock enabled")
					CAPABILITY_SET_CLOCK = true
				end

				-- Primary Keypad Function with PIN can be optionally disabled.
				if (bitMask(string.byte(string.sub(message,10)), 16)) then
					luup.log("Primary Keypad Function with PIN enabled")
					CAPABILITY_PRIMARY_KEYPAD_WITH_PIN = true
				end

				-- Secondary Keypad Function can be optionally disabled.
				if (bitMask(string.byte(string.sub(message,10)), 64)) then
					luup.log("Secondary Keypad Function enabled")
					CAPABILITY_SECONDARY_KEYPAD = true
				end

				-- Zone bypass can be optionally disabled.
				if (bitMask(string.byte(string.sub(message,10)), 128)) then
					luup.log("Zone bypass enabled")
					CAPABILITY_ZONE_BYPASS = true
				end

				return 0
			end
		}
	)
end

-- setInterfaceClock()
-- Tell the alarm system the current time.  It uses this when
-- it communicates with the back-to-base monitoring service
-- and it may display it on alphanumeric keypads.
function setInterfaceClock(deviceId)
	if (LOG_DEBUG) then luup.log("Sending message and waiting for response: 0x3b Set Interface Clock") end
	local timeTable = os.date("*t")
	return sendMessageAndHandleResponse(ROOT_DEVICE, string.char(0x3b + 128) .. string.format("%c%c%c%c%c%c",
			timeTable["year"] % 100,
			timeTable["month"],
			timeTable["day"],
			timeTable["hour"],
			timeTable["min"],
			timeTable["wday"]),
		{
			[29] = function (deviceId, message)
				return 0
			end,
			[31] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Failed to set clock on interface") end
				return 0
			end,
			["timeout"] = function (deviceId, message)
				-- Not the end of the world.
				if (LOG_DEBUG) then luup.log("Timeout while setting clock on interface") end
				return 0
			end,
		}
	)
end

-- getSystemStatus(deviceId)
-- Request the state of the alarm system:
-- - List of valid partitions.
-- - 4- or 6-digit PIN codes.
function getSystemStatus(deviceId)
	if (LOG_DEBUG) then luup.log("Sending message and waiting for response: 0x28 System Status Request") end

	PARTITION_VALID = {}

	-- Callbacks to handle System Status request.
	return sendMessageAndHandleResponse(ROOT_DEVICE, "\040", 
		{
			[8] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Handling message: 0x08 System Status") end

				-- Byte 10 of the response contains a list of valid partitions.
				VALID_PARTITIONS_BITMASK = string.byte(string.sub(message,10))
				for partition = 1, 8 do
					if (bitMask(VALID_PARTITIONS_BITMASK, 2^(partition-1))) then
						luup.log(string.format("Valid partition %d", partition))
						PARTITION_VALID[partition] = true
					end
				end

				-- Byte 6 contains 4- or 6-digit PINs
				if (bitMask(string.byte(string.sub(message,6)), 1)) then
					CONFIGURATION_PIN_LENGTH = 6
				else
					CONFIGURATION_PIN_LENGTH = 4
				end
				luup.log(string.format("PIN length is %d", CONFIGURATION_PIN_LENGTH))

				return 0
			end
		}
	)
end

-- setUpPartition(deviceId, childDevices, p)
-- p: number, partition (1 origin)
-- Returns true if the received reply was for the requested partition,
-- otherwise false (and the caller should try again).
function setUpPartition(deviceId, childDevices, p)
	if (LOG_DEBUG) then luup.log("Sending message and waiting for response: 0x26 Partition Status Request") end

	local partitionConfigured = false

	sendMessageAndHandleResponse(ROOT_DEVICE, "\038" .. string.char(p - 1),
		{
			[6] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Handling message: 0x06 Partition Status") end
				if (string.byte(string.sub(message,1)) == p - 1) then
					-- This is the partition we were asking about.
					-- Partitions aren't named, so invent a suitable name.
					PARTITION_STATUS[p]["name"] = "Partition " .. p
					luup.chdev.append(
						ROOT_DEVICE, childDevices,
						"Partition-" .. p, PARTITION_STATUS[p]["name"],
						"urn:schemas-futzle-com:device:CaddxNX584Partition:2", "D_CaddxNX584Partition2.xml",
						"", "", true
					)
					processPartitionStatusMessage(message)
					partitionConfigured = true
				else
					-- This partition may have been configured already.
					-- May as well note the changed state.
					processPartitionStatusMessage(message)
				end
				return 0
			end,
			[7] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Handling message: 0x07 Partitions Snapshot") end
				-- This isn't a response to our request, but we should
				-- note the status changes for the paritions that we've
				-- already processed.
				processPartitionsSnapshotMessage(message)
				return 0
			end
		}
	)
	return partitionConfigured
end

-- setUpZone(deviceId, childDevices, z)
-- Get information about a zone and create a child device for it.
-- z: Zone number (1 origin)
-- Returns true if the zone is known, otherwise returns false.
function setUpZone(deviceId, childDevices, z)
	if (LOG_DEBUG) then luup.log("Searching for zone " .. z) end
	local deviceFile = luup.variable_get(ALARM_SERVICEID, "Zone" .. z .. "Type", ROOT_DEVICE)
	local deviceName = luup.variable_get(ALARM_SERVICEID, "Zone" .. z .. "Name", ROOT_DEVICE)
	if (deviceFile ~= nil and deviceFile ~= "") then
			if (LOG_DEBUG) then luup.log(string.format("Zone %d (%s): %s", z, deviceName, deviceFile)) end
		luup.chdev.append(
			ROOT_DEVICE, childDevices,
			"Zone-" .. z, deviceName,
			"", deviceFile,
			"I_CaddxNX584Security.xml", "", false
		)
		return true
	end
	return false
end

--
-- Shared code for processing messages during setup and normal operation.
--

-- processPartitionStatusMessage(message)
-- Update the state of a child device upon receipt of a 0x06 Partition Status message.
-- message: The body of the message.  The partition must already be configured.
function processPartitionStatusMessage(message)
	local partition = string.byte(string.sub(message,1)) + 1
	PARTITION_STATUS[partition]["isArmed"] = bitMask(string.byte(string.sub(message,2)), 64)
	PARTITION_STATUS[partition]["isPartial"] = bitMask(string.byte(string.sub(message,4)), 4)
	PARTITION_STATUS[partition]["isSiren"] = bitMask(string.byte(string.sub(message,3)), 2)
	PARTITION_STATUS[partition]["wasSiren"] = bitMask(string.byte(string.sub(message,3)), 1)
	PARTITION_STATUS[partition]["isReady"] = bitMask(string.byte(string.sub(message,7)), 4)
	PARTITION_STATUS[partition]["isChime"] = bitMask(string.byte(string.sub(message,4)), 8)
	PARTITION_STATUS[partition]["isExitDelay"] = bitMask(string.byte(string.sub(message,4)), 192)
	PARTITION_STATUS[partition]["isEntryDelay"] = bitMask(string.byte(string.sub(message,4)), 16) or
		bitMask(string.byte(string.sub(message,8)), 1)
	PARTITION_STATUS[partition]["lastUser"] = string.byte(string.sub(message,6))
	return partition
end

-- processPartitionsSnapshotMessage(message)
-- Update the state of all child partition devices that are configured.
function processPartitionsSnapshotMessage(message)
	for partition = 1,8 do
		if (PARTITION_VALID[parition] and PARTITION_CONFIGURED[partition]) then
			PARTITION_STATUS[partition]["isArmed"] = bitMask(string.byte(string.sub(message,partition+1)), 4)
			PARTITION_STATUS[partition]["isPartial"] = bitMask(string.byte(string.sub(message,partition+1)), 8)
			PARTITION_STATUS[partition]["isReady"] = bitMask(string.byte(string.sub(message,partition+1)), 2)
			PARTITION_STATUS[partition]["isChime"] = bitMask(string.byte(string.sub(message,partition+1)), 16)
			PARTITION_STATUS[partition]["isExitDelay"] = bitMask(string.byte(string.sub(message,partition+1)), 64)
			PARTITION_STATUS[partition]["isEntryDelay"] = bitMask(string.byte(string.sub(message,partition+1)), 32)
			PARTITION_STATUS[partition]["wasSiren"] = bitMask(string.byte(string.sub(message,partition+1)), 128)
		end
	end
end

-- processZoneStatusMessage(message)
-- Update the state of a child device upon receipt of a 0x04 Zone Status message.
-- message: The body of the message.  The zone must already be configured.
function processZoneStatusMessage(message)
	local zone = string.byte(string.sub(message,1)) + 1
	local partitions = bitAnd(string.byte(string.sub(message,2)), VALID_PARTITIONS_BITMASK)
	if (partitions ~= 0) then
		if (LOG_DEBUG) then luup.log(string.format("Valid zone %d", zone)) end
		ZONE_VALID[zone] = true
		ZONE_STATUS[zone]["isFaulted"] = bitMask(string.byte(string.sub(message,6)), 1)
		ZONE_STATUS[zone]["isBypassed"] = bitMask(string.byte(string.sub(message,6)), 8)
	end
	return zone
end

-- processZonesSnapshotMessage(message)
-- Update the state of all child partition devices that are configured.
function processZonesSnapshotMessage(message)
	-- First byte is the set of 16 zones in this snapshot.
	local z16 = string.byte(string.sub(message,2)) * 16
	for zone2 = 1,8 do
		-- Two zones per byte.
		if (ZONE_VALID[z16+zone2*2-1]) then
			ZONE_STATUS[z16+zone2*2-1]["isFaulted"] = bitMask(string.byte(string.sub(message,zone2+1)), 1)
			ZONE_STATUS[z16+zone2*2-1]["isBypassed"] = bitMask(string.byte(string.sub(message,zone2+1)), 2)
		end
		if (ZONE_VALID[z16+zone2*2]) then
			ZONE_STATUS[z16+zone2*2]["isFaulted"] = bitMask(string.byte(string.sub(message,zone2+1)), 16)
			ZONE_STATUS[z16+zone2*2]["isBypassed"] = bitMask(string.byte(string.sub(message,zone2+1)), 32)
		end
	end
	return z16
end

-- updatePartitionDevice(deviceId, partition)
-- Update the Luup child device corresponding to the partition
-- with information previously set in the PARTITION_STATUS variable.
function updatePartitionDevice(deviceId, partition)
	if (partition ~= nil) then
		if (LOG_DEBUG) then luup.log("Setting state for partition " .. partition) end
		local partitionDevice = findChild(ROOT_DEVICE, "Partition-" .. partition)
		if (partitionDevice == nil) then return end

		-- Create a variable on the alarm interface matching the user who
		-- last changed the partition, if there isn't already.
		local lastUser = luup.variable_get(ALARM_SERVICEID, "User" .. PARTITION_STATUS[partition]["lastUser"], ROOT_DEVICE)
		if (lastUser == nil) then
			lastUser = "User " .. PARTITION_STATUS[partition]["lastUser"]
			luup.variable_set(ALARM_SERVICEID, "User" .. PARTITION_STATUS[partition]["lastUser"], lastUser, ROOT_DEVICE)
		end
		-- This is the user who last modified the partition.
		luup.variable_set(ALARM_PARTITION_SERVICEID, "LastUser", lastUser, partitionDevice)

		-- Chime mode.
		local chime = PARTITION_STATUS[partition]["isChime"] and "1" or "0"
		if (LOG_DEBUG) then luup.log("ChimeEnabled: " .. chime) end
		luup.variable_set(ALARM_PARTITION_SERVICEID, "ChimeEnabled", chime, partitionDevice)

		-- Past alarm (which has since cleared).
		local pastAlarm = PARTITION_STATUS[partition]["wasSiren"] and "1" or "0"
		if (LOG_DEBUG) then luup.log("AlarmMemory: " .. pastAlarm) end
		luup.variable_set(ALARM_PARTITION_SERVICEID, "AlarmMemory", pastAlarm, partitionDevice)

		-- Current alarm.
		local breached = PARTITION_STATUS[partition]["isSiren"] and "Active" or "None"
		if (LOG_DEBUG) then luup.log("Alarm: " .. breached) end
		luup.variable_set(ALARM_PARTITION_SERVICEID, "Alarm", breached, partitionDevice)

		-- Detailed armed state.
		-- Listed in increasing order of importance.
		local detailArmed = "Disarmed"
		detailArmed = PARTITION_STATUS[partition]["isReady"] and "Ready" or detailArmed
		detailArmed = PARTITION_STATUS[partition]["isArmed"] and "Armed" or detailArmed
		detailArmed = PARTITION_STATUS[partition]["isPartial"] and "Stay" or detailArmed
		detailArmed = PARTITION_STATUS[partition]["isExitDelay"] and "ExitDelay" or detailArmed
		detailArmed = PARTITION_STATUS[partition]["isEntryDelay"] and "EntryDelay" or detailArmed
		if (LOG_DEBUG) then luup.log("DetailedArmMode: " .. detailArmed) end
		luup.variable_set(ALARM_PARTITION_SERVICEID, "DetailedArmMode", detailArmed, partitionDevice)

		-- Simple armed state (armed or not).
		local armed = PARTITION_STATUS[partition]["isArmed"] and "Armed" or "Disarmed"
		if (LOG_DEBUG) then luup.log("ArmMode: " .. armed) end
		luup.variable_set(ALARM_PARTITION_SERVICEID, "ArmMode", armed, partitionDevice)
	end
end

-- updateZoneDevice(deviceId, zone)
-- Update the Luup child device corresponding to the zone
-- with information previously set in the ZONE_STATUS variable.
function updateZoneDevice(deviceId, zone)
	if (zone ~= nil) then
		if (LOG_DEBUG) then luup.log("Setting state for zone " .. zone) end
		local zoneDevice = findChild(ROOT_DEVICE, "Zone-" .. zone)
		if (zoneDevice == nil) then return end

		local tripped = ZONE_STATUS[zone]["isFaulted"] and "1" or "0"
		if (LOG_DEBUG) then luup.log("Tripped: " .. tripped) end
		luup.variable_set(ALARM_ZONE_SERVICEID, "Tripped", tripped, zoneDevice)

		-- Invert logic because alarm panel speaks of "is bypassed".
		local armed = ZONE_STATUS[zone]["isBypassed"] and "0" or "1"
		if (LOG_DEBUG) then luup.log("Armed: " .. armed) end
		luup.variable_set(ALARM_ZONE_SERVICEID, "Armed", armed, zoneDevice)
	end
end

--
-- Handlers for asynchronous messages from the alarm system.
--

-- handleZoneStatusMessage(deviceId, message)
-- We received a zone status message.
-- Use the information in it to update the zone device.
function handleZoneStatusMessage(deviceId, message)
	if (LOG_DEBUG) then luup.log("Handling message: 0x04 Zone Status") end
	local zone = processZoneStatusMessage(message)
	updateZoneDevice(ROOT_DEVICE, zone)
	return 0
end

-- handleZonesSnapshotMessage(deviceId, message)
-- We received a zones snapshot message for a bank of 16 zones.
-- Use the information in it to update the zone devices.
function handleZonesSnapshotMessage(deviceId, message)
	if (LOG_DEBUG) then luup.log("Handling message: 0x05 Zones Snapshot") end
	local z16 = processZonesSnapshotMessage(message)
	for zone = z16*16+1,z16*16+16 do
		if (ZONE_VALID[zone]) then
			updateZoneDevice(ROOT_DEVICE, zone)
		end
	end
	return 0
end

-- handlePartitionStatusMessage(deviceId, message)
-- We received a partition status message.
-- Use the information in it to update the partition device.
function handlePartitionStatusMessage(deviceId, message)
	if (LOG_DEBUG) then luup.log("Handling message: 0x06 Partition Status") end
	local partition = processPartitionStatusMessage(message)
	updatePartitionDevice(ROOT_DEVICE, partition)
	return 0
end

-- handlePartitionsSnapshotMessage(deviceId, message)
-- We received a partitions snapshot message for all eight partitions.
-- Use the information in it to update the partition devices.
function handlePartitionsSnapshotMessage(deviceId, message)
	if (LOG_DEBUG) then luup.log("Handling message: 0x07 Partitions Snapshot") end
	processPartitionsSnapshotMessage(message)
	for parition = 1,8 do
		if (PARTITION_VALID[partition]) then
			updatePartitionDevice(ROOT_DEVICE, partition)
		end
	end
	return 0
end

function handleSystemStatusMessage()
	if (LOG_DEBUG) then luup.log("Handling message: 0x08 System Status") end
	-- Anything to do? We shouldn't be getting this message spontaneously, should we?
	return 0
end

function handleLogEventMessage()
	if (LOG_DEBUG) then luup.log("Handling message: 0x0a Log Event") end
	-- To do.
	return 0
end

--
-- Utility functions for communicating with the interface.
--

-- sendCommandFailedMessage()
-- Send Command Failed if plugin was unable to do something
-- asked of it by the alarm system.
function sendCommandFailedMessage()
	if (LOG_DEBUG) then luup.log("Sending message: 0x1C Command Failed") end
	sendMessage("\028") -- 28 == 0x1C
end

-- sendPositiveAcknowledgeMessage()
-- Send Positive Acknowledgment if plugin was asked to
-- acknowledge something by the alarm system.
function sendPositiveAcknowledgeMessage()
	if (LOG_DEBUG) then luup.log("Sending message: 0x1D Positive Acknowledge") end
	sendMessage("\029") -- 29 == 0x1D
end

-- sendNegativeAcknowledgeMessage()
-- Send Negative Acknowledgment if plugin received a garbled
-- message or if the alarm system tries to send a second
-- message before the first is acknowledged.
function sendNegativeAcknowledgeMessage()
	if (LOG_DEBUG) then luup.log("Sending message: 0x1E Negative Acknowledge") end
	sendMessage("\030") -- 30 == 0x1E
end

-- sendMessageRejectedMessage()
-- Send Message Rejection if plugin received a message,
-- it is valid, but the interface doesn't know what to
-- do with it.
-- Experience suggests the interface doesn't expect to
-- receive this message, but only to send it.
function sendMessageRejectedMessage()
	if (LOG_DEBUG) then luup.log("Sending message: 0x1F Message Reject") end
	sendMessage("\031") -- 31 == 0x1F
end

-- packByte(b)
-- Escape bytes 0x7e and 0x7d to ensure that the start byte (0x7e)
-- is never seen in the middle of a message.
function packByte(b)
	if (b == 0x7e) then
		return "\125\094" -- 0x7d 0x5e
	elseif (b == 0x7d) then
		return "\125\093" -- 0x7d 0x5d
	else
		return string.char(b)
	end
end

-- sendMessage(message)
-- Byte-stuff the message, prepend the start byte 0x7e and the length,
-- append the checksum, and send it.
function sendMessage(message)
	local packedMessage = string.char(0x7e)
	resetChecksum()
	-- Length should be always short enough to avoid byte-stuffing issues.
	packedMessage = packedMessage .. string.char(string.len(message))
	updateChecksum(string.len(message))
	for i = 1, string.len(message) do
		local b = string.byte(message,i)
		updateChecksum(b)
		packedMessage = packedMessage .. packByte(b)
	end
	local c1, c2 = getChecksum()
	packedMessage = packedMessage .. packByte(c1) .. packByte(c2)
	if (LOG_DEBUG) then logMessage("Outgoing:", packedMessage) end
	luup.io.write(packedMessage)
end

function resetChecksum()
	CHECKSUM1 = 0
	CHECKSUM2 = 0
end

function updateChecksum(b)
	if (255 - CHECKSUM1 < b) then
		CHECKSUM1 = CHECKSUM1 + 1
	end
	CHECKSUM1 = CHECKSUM1 + b
	if (CHECKSUM1 > 255) then
		CHECKSUM1 = CHECKSUM1 - 256
	end
	if (CHECKSUM1 == 255) then
		CHECKSUM1 = 0
	end
	if (255 - CHECKSUM2 < CHECKSUM1) then
		CHECKSUM2 = CHECKSUM2 + 1
	end
	CHECKSUM2 = CHECKSUM2 + CHECKSUM1
	if (CHECKSUM2 > 255) then
		CHECKSUM2 = CHECKSUM2 - 256
	end
	if (CHECKSUM2 == 255) then
		CHECKSUM2 = 0
	end
end

function getChecksum()
	return CHECKSUM1, CHECKSUM2
end

-- handleMessage(deviceId, handlers, messageType, message, acknowledge)
-- Figure out which function should handle this message, and call that function
-- with the message.
function handleMessage(deviceId, handlers, messageType, message, acknowledge)
	if (messageType == "timeout") then
		if (LOG_DEBUG) then luup.log(string.format("Handling timeout", messageType)) end
	elseif (acknowledge) then
		if (LOG_DEBUG) then luup.log(string.format("Received good message 0x%02x, acknowledge requested", messageType)) end
	else
		if (LOG_DEBUG) then luup.log(string.format("Received good message 0x%02x", messageType)) end
	end
	if (LOG_DEBUG and message ~= nil) then logMessage("Incoming message body:", message) end
	if (handlers[messageType] ~= nil) then
		local f = handlers[messageType]
		local status = f(deviceId, message)
		if (status == 0 and acknowledge) then
			sendPositiveAcknowledgeMessage()
		elseif (acknowledge) then
			sendCommandFailedMessage()
		end
	elseif (acknowledge) then
		-- Spec says we should send a Message Reject, but this doesn't
		-- seem to shut the alarm system up.  Pretend we understood.
		sendPositiveAcknowledgeMessage()
	end
	return true
end

-- logMessage(prefix, message)
-- Send to the log the bytes that make up the message.
function logMessage(prefix, message)
	logText = prefix
	for i = 1, string.len(message) do
		local b = string.byte(message,i)
		logText = logText .. string.format(" 0x%02x", b)
	end
	luup.log("Message: " .. logText)
end

-- readByte(lul_data)
-- Given the next byte of input (lul_data),
-- return the next message encoded in the input.
-- Return values (inspired by the Luup job status codes, but not related):
-- - Message complete: 4, messageId, messageBody, acknowledgeRequired
-- - Message not yet complete: 5
-- - Bad checksum: 2, expectedChecksum, receivedChecksum
-- - Garbage byte outside message: 3, byteReceived
function readByte(lul_data)
	if (RECEIVE_STATE == nil) then
		if (LOG_DEBUG) then luup.log("State machine not yet initialized") end
		return
	end
	if (lul_data == nil) then
		if (LOG_DEBUG) then luup.log("Input is nil") end
		return 4, "timeout"
	end
	local b = string.byte(lul_data)
	if (b == 0x7e) then
		-- Start of a message.
		if (RECEIVE_STATE ~= INCOMING_EXPECTING_START) then
			-- Start byte should occur only at the start of a message,
			-- so assume previous message is truncated and start again.
			if (LOG_DEBUG) then luup.log("Discarding previous incomplete message") end
		end
		resetChecksum()
		RECEIVE_STATE = INCOMING_EXPECTING_LENGTH
		INCOMING_ESCAPED = 0x0
		return 5 -- Message incomplete.
	elseif (RECEIVE_STATE == INCOMING_EXPECTING_START) then
		-- Garbage byte (or ASCII mode).
		if (LOG_DEBUG) then luup.log(string.format("Ignoring byte %02x", b)) end
		return 3, b -- Garbage byte
	elseif (b == 0x7d) then
		-- First byte of a byte-stuffed pair.
		INCOMING_ESCAPED = 0x20
		return 5
	else
		-- Everything from here on participates in the checksum computation.
		b = b + INCOMING_ESCAPED  -- Either 0 (or 0x20 if second byte of a byte-stuffed pair)
		INCOMING_ESCAPED = 0x0
		updateChecksum(b)
		if (RECEIVE_STATE == INCOMING_EXPECTING_LENGTH) then
			-- Length includes message type, message and checksum.
			LENGTH = b
			RECEIVE_STATE = INCOMING_EXPECTING_TYPE
		else
			LENGTH = LENGTH - 1
			if (RECEIVE_STATE == INCOMING_EXPECTING_TYPE) then
				-- Type is format a0xxxxxx:
				-- a == 0 means do not acknowledge the message.
				-- a == 1 means acknowledge the message.
				-- xxxxxx is the message number (0 to 63).
				if (b > 127) then
					ACKNOWLEDGE = true
				else
					ACKNOWLEDGE = false
				end
				MESSAGE_NUMBER = b % 64
				RECEIVE_STATE = INCOMING_EXPECTING_MESSAGE
				MESSAGE = ""
			elseif (RECEIVE_STATE == INCOMING_EXPECTING_MESSAGE) then
				-- Message body.
				MESSAGE = MESSAGE .. string.char(b)
			elseif (RECEIVE_STATE == INCOMING_EXPECTING_CHECKSUM1) then
				-- First byte of checksum.
				RECEIVED_CHECKSUM1 = b
				RECEIVE_STATE = INCOMING_EXPECTING_CHECKSUM2
			elseif (RECEIVE_STATE == INCOMING_EXPECTING_CHECKSUM2) then
				-- First byte of checksum.
				if (EXPECTED_CHECKSUM1 == RECEIVED_CHECKSUM1 and
					EXPECTED_CHECKSUM2 == b) then
					-- Good checksum.
					RECEIVE_STATE = INCOMING_EXPECTING_START
					return 4, 
						MESSAGE_NUMBER,
						MESSAGE,
						ACKNOWLEDGE
				else
					-- Bad checksum.  Send Negative Acknowledge (0x1e)
					if (LOG_DEBUG) then luup.log(string.format("Expected checksum: 0x%02x 0x%02x", EXPECTED_CHECKSUM1, EXPECTED_CHECKSUM2)) end
					if (LOG_DEBUG) then luup.log(string.format("Received checksum: 0x%02x 0x%02x", RECEIVED_CHECKSUM1, b)) end
					RECEIVE_STATE = INCOMING_EXPECTING_START
					return 2,
						string.format("%c%c", EXPECTED_CHECKSUM1, EXPECTED_CHECKSUM2),
						string.format("%c%c", RECEIVED_CHECKSUM1, b)
				end
			end
			if (LENGTH == 0) then
				-- Received all bytes.
				EXPECTED_CHECKSUM1, EXPECTED_CHECKSUM2 = getChecksum()
				RECEIVE_STATE = INCOMING_EXPECTING_CHECKSUM1
			end
		end
		return 5
	end
end

-- handleReadByteResult(lul_job, state, a, b, c)
-- We've just read a byte from the alarm system.
-- - If the message is complete and the checksum is correct, handle it.
-- - If there was an error, react.
-- - If the message isn't over yet, keep going.
function handleReadByteResult(lul_job, deviceId, state, a, b, c)
	if (PERMANENT_HANDLERS == nil) then
		if (LOG_DEBUG) then luup.log("Global handlers not set up yet") end
		return
	end
	if (CURRENT_JOB and getJobId(lul_job) ~= CURRENT_JOB) then
		-- Not my job.
		return 5, 10, false
	end
	if (state == 4) then
		-- Message complete.  Dispatch it.
		local handlers = {}
		for k, v in pairs(PERMANENT_HANDLERS) do
			handlers[k] = v
		end
		for k, v in pairs(TEMPORARY_HANDLERS) do
			handlers[k] = v
		end
		local messageResult = handleMessage(deviceId, handlers, a, b, c)
		-- May have queued a message to send.
		processSendQueue()
		-- Job finished?
		if (lul_job and JOBS[getJobId(lul_job)]["complete"]) then
			-- Job finished, successfully or not.
			CURRENT_JOB = nil
			processSendQueue()
			return JOBS[getJobId(lul_job)]["complete"], 0, true
		else
			-- Job not finished.  More bytes needed.
			processSendQueue()
			return 5, 10, true
		end
	elseif (state == 2) then
		-- Bad checksum.  Send a negative acknowledgment message.
		sendNegativeAcknowledgeMessage()
		processSendQueue()
	elseif (state == 3) then
		-- Junk byte.  Do nothing.  We will get the message again.
	else
		-- state == 5
		-- Nothing to do yet.
	end
	return 5, 10, true
end

-- processSendQueue()
-- If there are pending messages to send to the interface,
-- send one now.
function processSendQueue()
	if (RECEIVE_STATE == INCOMING_EXPECTING_START) then
		TEMPORARY_HANDLERS = {}
		CURRENT_JOB = getPendingJob()
		if (CURRENT_JOB ~= nil) then
			-- There is a request still to send to the alarm interface.
			TEMPORARY_HANDLERS = JOBS[CURRENT_JOB]["handlers"]
			if (JOBS[CURRENT_JOB]["tosend"]) then
				-- Send the message to the alarm interface.
				local message = JOBS[CURRENT_JOB]["message"]
				JOBS[CURRENT_JOB]["tosend"] = false
				sendMessage(message)
			end
		end
	end
end

-- addPendingJob(job, message, handlers)
-- Log a message that we'd like to send to the interface.
-- It may not be convenient to send now, so add it to a queue.
function addPendingJob(job, message, handlers)
	JOBS[job] = {
		["complete"] = false,
		["message"] = message,
		["handlers"] = handlers,
		["tosend"] = true
	}
	JOBS_PENDING_SEND_TAIL = JOBS_PENDING_SEND_TAIL + 1
	JOBS_PENDING_SEND[JOBS_PENDING_SEND_TAIL] = job
end

-- getPendingJob()
-- Serve the head of the job queue, ready to send its message to the
-- interface.
function getPendingJob()
	if (JOBS_PENDING_SEND_TAIL >= JOBS_PENDING_SEND_HEAD) then
		local job = JOBS_PENDING_SEND[JOBS_PENDING_SEND_HEAD]
		-- if (LOG_DEBUG) then luup.log("Pending job.") end
		return job
	else
		-- if (LOG_DEBUG) then luup.log("No pending job.") end
		return nil
	end
end

-- pendingJobDone(job, status)
-- Remove the pending job from the queue.  The head of the queue
-- should match the given job.
function pendingJobDone(job, status)
	if (LOG_DEBUG) then luup.log("Finishing pending job " .. job) end
	-- Remove the job from the queue.
	JOBS[job]["complete"] = status
	if (JOBS_PENDING_SEND[JOBS_PENDING_SEND_HEAD] == job) then
		JOBS_PENDING_SEND[JOBS_PENDING_SEND_HEAD] = nil
		JOBS_PENDING_SEND_HEAD = JOBS_PENDING_SEND_HEAD + 1
	end
	return 0
end

-- getJobId(lul_job)
-- Get a unique string for this job.
-- It seems that lul_job is an opaque Lua userdata with no way
-- to access its contents (such as the Luup jobId).  A pity.
function getJobId(lul_job)
	return tostring(lul_job)
end

-- validatePin(p)
-- Check that a PIN is the right length,
-- and return a packed three-byte string containing the PIN as nibbles.
function validatePin(p)
	if (string.len(p) ~= 4 and CONFIGURATION_PIN_LENGTH == 4) then
		return nil
	elseif (string.len(p) ~= 6 and CONFIGURATION_PIN_LENGTH == 6) then
		return nil
	end

	local bytes = ""
	for c = 1,string.len(p),2 do
		-- Little endian.
		bytes = bytes .. string.char(tonumber(string.sub(p, c, c)) + tonumber(string.sub(p, c + 1, c + 1)) * 16)
	end

	-- Packed string must be three bytes long.
	if (CONFIGURATION_PIN_LENGTH == 4) then
		bytes = bytes .. "\000"
	end
		
	return bytes
end

-- unpackPin(s)
-- Extract a packed PIN into a human-readable string.
function unpackPin(s)
	if (string.len(s) ~= 3) then
		return nil
	end

	local result = ""
	-- F digit is for unset PINs.
	local digitValue = "0123456789ABCDE-"
	for c = 1,CONFIGURATION_PIN_LENGTH/2 do
		-- Little endian.
		local digit1 = 1 + string.byte(s:sub(c)) % 16
		result = result .. digitValue:sub(digit1, digit1)
		local digit2 = 1 + math.floor(string.byte(s:sub(c)) / 16)
		result = result .. digitValue:sub(digit2, digit2)
	end

	return result
end

-- getUserInformationJson(u)
-- Given a USER_SCAN[] entry, produce JSON output
-- for a lr_UserScan callback.
function getUserInformationJson(u)
	local authorization = {}
	if (u.authorization.arm ~= nil) then
		table.insert(authorization, "\"arm\": \"" .. u.authorization.arm .. "\"");
	end
	if (u.authorization.disarm ~= nil) then
		table.insert(authorization, "\"disarm\": \"true\"");
	end
	if (u.authorization.master ~= nil) then
		table.insert(authorization, "\"master\": \"true\"");
	end
	if (u.authorization.report ~= nil) then
		table.insert(authorization, "\"report\": \"true\"");
	end
	if (u.authorization.outputEnable ~= nil) then
		local outputEnable = {}
		for o = 1,4 do
			if (u.authorization.outputEnable[o]) then
				table.insert(outputEnable, o)
			end
		end
		table.insert(authorization, "\"outputEnable\": \"" .. table.concat(outputEnable, ",") .. "\"");
	end
	return "{" ..
		"\"pin\": \"" .. u.pin .. "\"," ..
		"\"partitions\": \"" .. u.partitions .. "\"," ..
		"\"authorization\": {" ..
			table.concat(authorization, ",") ..
    	"}" ..
    	"}"
end

-- getConfigurationJson()
-- Return the configuration learned at startup, as a JSON object.
-- Used by the JavaScript Configuration tab.
function getConfigurationJson()
	return "{" ..
		"\"pinLength\": " .. CONFIGURATION_PIN_LENGTH .. "," ..
		"\"capability\": { " ..
			"\"zoneName\": " .. (CAPABILITY_ZONE_NAME and "\"true\"" or "\"false\"") .. "," ..
			"\"setClock\": " .. (CAPABILITY_SET_CLOCK and "\"true\"" or "\"false\"") .. "," ..
			"\"getUserInformationWithPin\": " .. (CAPABILITY_GET_USER_INFORMATION_WITH_PIN and "\"true\"" or "\"false\"") .. "," ..
			"\"setUserCodeWithPin\": " .. (CAPABILITY_SET_USER_CODE_WITH_PIN and "\"true\"" or "\"false\"") .. "," ..
			"\"setUserAuthorizationWithPin\": " .. (CAPABILITY_SET_USER_AUTHORIZATION_WITH_PIN and "\"true\"" or "\"false\"") .. "," ..
			"\"primaryKeypadWithPin\": " .. (CAPABILITY_PRIMARY_KEYPAD_WITH_PIN and "\"true\"" or "\"false\"") .. "," ..
			"\"secondaryKeypad\": " .. (CAPABILITY_SECONDARY_KEYPAD and "\"true\"" or "\"false\"") .. "," ..
			"\"zoneBypass\": " .. (CAPABILITY_ZONE_BYPASS and "\"true\"" or "\"false\"") .. 
		"}" ..
		"}"
end

-- callbackHandler(lul_request, lul_parameters, lul_outputformat)
function callbackHandler(lul_request, lul_parameters, lul_outputformat)
	if (lul_outputformat == "json") then
		if (lul_request == "ZoneScan") then
			local z = tonumber(lul_parameters.zone)
			return "{ \"partitions\":\"" .. ZONE_SCAN[z].partitions .. "\" }"
		elseif (lul_request == "ZoneNameScan") then
			local z = tonumber(lul_parameters.zone)
			-- To do: escape string.
			return "{ \"name\":\"" .. ZONE_SCAN[z].name .. "\" }"
		elseif (lul_request == "UserScan") then
			local u = tonumber(lul_parameters.user)
			return getUserInformationJson(USER_SCAN[u])
		elseif (lul_request == "GetConfiguration") then
			return getConfigurationJson();
		end
	end
end

-- jobZoneScan(lul_device, lul_settings, lul_job)
-- Invoked by the JavaScript Zone configuration tab.
-- http://vera/port_3480/data_request?id=lu_action&serviceId=urn:futzle-com:serviceId:CaddxNX584Security1&action=ZoneScan&Zone=1&DeviceNum=n
-- Sets the ZONE_SCAN[] variable which is later fetched from callbackHandler().
function jobZoneScan(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Alarm: ZoneScan: " .. lul_device .. " " .. lul_settings.Zone .. " job " .. getJobId(lul_job)) end
	local z = tonumber(lul_settings.Zone)
	-- Ask for status of this zone.
	addPendingJob(getJobId(lul_job),
		"\036" .. string.char(z-1),
		{
			[4] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("ZoneScan job handling message: 0x04 Zone Status") end
				if (string.byte(string.sub(message,1)) == z - 1) then
					-- This is the zone we were asking about.
					if (LOG_DEBUG) then luup.log(string.format("ZoneScan Zone %d", z)) end
					if (ZONE_VALID[z]) then
						-- Still have responsibility to set state of zone.
						-- In truth, JavaScript will take pains not to scan a zone already in the system.
						processZoneStatusMessage(message)
						updateZoneDevice(ROOT_DEVICE, zone)
					end
					-- Extract list of partitions this zone is in.
					local validPartitions = ""
					local validPartitionsBitmask = string.byte(string.sub(message,2))
					for p = 1, 8 do
						if (bitMask(validPartitionsBitmask, 2^(p-1))) then
							if (validPartitions ~= "") then
								validPartitions = validPartitions .. ","
							end
							validPartitions = validPartitions .. p
						end
					end
					ZONE_SCAN[z] = {
						-- Valid partitions for this zone.
						partitions = validPartitions
					} 
					return pendingJobDone(getJobId(lul_job), 4)
				else
					-- This isn't the zone I asked about, but I may know about it.
					if (ZONE_VALID[string.byte(string.sub(message,1)) + 1]) then
						processZoneStatusMessage(message)
						updateZoneDevice(ROOT_DEVICE, zone)
					end
				end
				return 0
			end,
			[29] = function(deviceId, message)
				if (LOG_DEBUG) then luup.log("ZoneScan job request acknowledged") end
				return 0
			end,
			[31] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end

-- jobZoneNameScan(lul_device, lul_settings, lul_job)
-- Invoked by the JavaScript Zone configuration tab.
-- http://vera/port_3480/data_request?id=lu_action&serviceId=urn:futzle-com:serviceId:CaddxNX584Security1&action=ZoneNameScan&Zone=1&DeviceNum=n
-- If successful, sets the ZONE_SCAN[] variable which is later fetched from callbackHandler().
function jobZoneNameScan(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Alarm: ZoneNameScan: " .. lul_device .. " " .. lul_settings.Zone .. " job " .. getJobId(lul_job)) end
	if (not CAPABILITY_ZONE_NAME) then
		-- Not allowed to ask zone names.  Return error.
		return 2, nil
	end
	local z = tonumber(lul_settings.Zone)
	-- Ask for status of this zone.
	addPendingJob(getJobId(lul_job),
		"\035" .. string.char(z - 1), 
		{
			[3] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Handling message: 0x03 Zone Name") end
				-- First byte is the zone number.
				local zoneNumber = string.byte(string.sub(message,1)) + 1
				if (z ~= zoneNumber) then
					-- This isn't the zone I was asking about.
					-- (Who else is asking about zone names?)
					return 0
				end
				-- Next 16 bytes are the zone name.  Strip trailing spaces.
				local zoneName = string.gsub(string.sub(message,2,17), " *$", "")
				if (zoneName == "") then
					-- No name, so stop trying.
					return pendingJobDone(getJobId(lul_job), 2)
				end
				-- Use this zone name.
				-- Assume ZoneScan has already created ZONE_SCAN[z].
				ZONE_SCAN[z].name = zoneName 
				return pendingJobDone(getJobId(lul_job), 4)
			end,
			[31] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Handling message: 0x1F Message Reject") end
				-- The interface can't give me a zone name after all.
				return pendingJobDone(getJobId(lul_job), 2)
			end,
			["timeout"] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("Timeout while getting zone name") end
				-- The interface can't give me a zone name after all.
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end

-- jobUserScan(lul_device, lul_settings, lul_job)
-- Invoked by the JavaScript User configuration tab.
-- http://vera/port_3480/data_request?id=lu_action&serviceId=urn:futzle-com:serviceId:CaddxNX584Security1&action=UserScan&User=1&MasterPIN=xxxx&DeviceNum=n
-- Sets the USER_SCAN[] variable which is later fetched from callbackHandler().
function jobUserScan(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Alarm: UserScan: " .. lul_device .. " " .. lul_settings.User .. " job " .. getJobId(lul_job)) end

	if (not CAPABILITY_GET_USER_INFORMATION_WITH_PIN) then
		-- Cannot get user information; return error.
		return 2, nil
	end
	local masterPIN = validatePin(lul_settings.MasterPIN)
	if (masterPIN == nil) then return 2, nil end

	local u = tonumber(lul_settings.User)
	if (u == nil) then return 2, nil end

	-- Ask for info about this user.
	addPendingJob(getJobId(lul_job),
		"\050" .. masterPIN .. string.char(u),
		{
			[18] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("UserScan job handling message: 0x12 User Information Reply") end
				if (string.byte(string.sub(message,1)) == u) then
					-- This is the user we were asking about.
					if (LOG_DEBUG) then luup.log(string.format("UserScan User %d", u)) end

					-- Get the user's PIN.
					local pin = unpackPin(string.sub(message,2,4))

					-- Get the user's authorization.
					local authorization = {}
					-- High bit affects meaning of other bits.
					if (bitMask(string.byte(string.sub(message,5)), 128)) then
						authorization["outputEnable"] = {}
						authorization["outputEnable"][1] = bitMask(string.byte(string.sub(message,5)), 1)
						authorization["outputEnable"][2] = bitMask(string.byte(string.sub(message,5)), 2)
						authorization["outputEnable"][3] = bitMask(string.byte(string.sub(message,5)), 4)
						authorization["outputEnable"][4] = bitMask(string.byte(string.sub(message,5)), 8)
					else
						if (bitMask(string.byte(string.sub(message,5)), 2)) then authorization["arm"] = "all" end
						if (bitMask(string.byte(string.sub(message,5)), 4)) then authorization["arm"] = "closing" end
						if (bitMask(string.byte(string.sub(message,5)), 8)) then authorization["master"] = true end
					end
					if (bitMask(string.byte(string.sub(message,5)), 16)) then
						authorization["arm"] = "all"
						authorization["disarm"] = true 
					end
					if (bitMask(string.byte(string.sub(message,5)), 32)) then authorization["bypass"] = true end
					if (bitMask(string.byte(string.sub(message,5)), 64)) then authorization["report"] = true end

					-- Extract list of partitions this zone is in.
					local authorizedPartitions = ""
					local authorizedPartitionsBitmask = string.byte(string.sub(message,6))
					for p = 1, 8 do
						if (bitMask(authorizedPartitionsBitmask, 2^(p-1))) then
							if (authorizedPartitions ~= "") then
								authorizedPartitions = authorizedPartitions .. ","
							end
							authorizedPartitions = authorizedPartitions .. p
						end
					end

					USER_SCAN[u] = {
						partitions = authorizedPartitions,
						authorization = authorization,
						pin = pin,
					} 
					return pendingJobDone(getJobId(lul_job), 4)
				end
				return 0
			end,
			[28] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
			[29] = function(deviceId, message)
				if (LOG_DEBUG) then luup.log("UserScan job request acknowledged") end
				return 0
			end,
			[31] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end

-- jobSetArmed(lul_device, lul_settings, lul_job)
-- Set the armed/bypass state of a zone device.
function jobSetArmed(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Zone: SetArmed " .. lul_device .. " " .. lul_settings.newArmedValue .. " job " .. getJobId(lul_job)) end
	
	if (not CAPABILITY_ZONE_BYPASS) then
		-- Cannot bypass; return error.
		return 2, nil
	end
	local zone = tonumber(string.match(luup.devices[lul_device].id, "%d+"))
	if (ZONE_STATUS[zone]["isBypassed"] == (lul_settings.newArmedValue == "0")) then
		-- Already the correct state, nothing to do.
		if (LOG_DEBUG) then luup.log("Job: already in that state.") end
		return 4, nil
	end

	if (LOG_DEBUG) then luup.log("Job: Adding job") end
	addPendingJob(getJobId(lul_job),
		"\063" .. string.char(zone-1),
		{
			[4] = function (deviceId, message)
				if (LOG_DEBUG) then luup.log("SetArmed job handling message: 0x04 Zone Status") end
				if (string.byte(string.sub(message,1)) == zone - 1) then
					-- This is the zone we were asking about.
					if (LOG_DEBUG) then luup.log(string.format("Zone %d", zone)) end
					handleZoneStatusMessage(ROOT_DEVICE, message)
					if (ZONE_STATUS[zone]["isBypassed"] == (lul_settings.newArmedValue == "0")) then
						return pendingJobDone(getJobId(lul_job), 4)
					end
				else
					-- This isn't the zone I asked about, but I may know about it.
					if (ZONE_VALID[string.byte(string.sub(message,1)) + 1]) then
						handleZoneStatusMessage(ROOT_DEVICE, message)
					end
				end
				return 0
			end,
			[29] = function(deviceId, message)
				return 0
			end,
			[31] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end

-- jobRequestQuickArmMode(lul_device, lul_settings, lul_job)
-- Arm or stay-arm a partition without a PIN code.
function jobRequestQuickArmMode(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Partition: RequestQuickArmMode to " .. lul_settings.State .. " " .. lul_device .. " job " .. getJobId(lul_job)) end
	
	if (not CAPABILITY_SECONDARY_KEYPAD) then
		-- Cannot quick arm; return error.
		return 2, nil
	end
	local partition = tonumber(string.match(luup.devices[lul_device].id, "%d+"))

	-- Protocol doc says that command (second byte) for "Exit" mode should be message 2,
	-- but on my system it seems that message 0 does the job.  Hmm.  Hope it isn't
	-- different depending on what panel you've got.  That'd be crazy.
	local command = {
		Armed = "\002",
		Stay = "\000"
	}
	local commandByte = command[lul_settings.State]
	if (commandByte == nil) then
		-- Command not supported.
		return 2, nil
	end
	if (LOG_DEBUG) then luup.log("Job: Adding job") end
	addPendingJob(getJobId(lul_job),
		"\062" .. commandByte .. string.char(2 ^ (partition-1)),
		{
			[29] = function(deviceId, message)
				-- Nothing more to do.  The interface will
				-- send a snapshot with the updated info RSN,
				-- and we'll update the partition device then.
				return pendingJobDone(getJobId(lul_job), 4)
			end,
			[31] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end

-- jobRequestArmMode(lul_device, lul_settings, lul_job)
-- Arm, stay-arm or disarm a partition with a PIN code.
function jobRequestArmMode(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Partition: RequestArmMode to " .. lul_settings.State .. " ".. lul_device .. " job " .. getJobId(lul_job)) end
	if (lul_settings.PINCode == nil or string.len(lul_settings.PINCode) == 0) then
		-- With no PIN, act the same as Quick Arm.
		return jobRequestQuickArmMode(lul_device, lul_settings, lul_job)
	end
	
	if (not CAPABILITY_PRIMARY_KEYPAD_WITH_PIN) then
		-- Cannot arm; return error.
		return 2, nil
	end
	local partition = tonumber(string.match(luup.devices[lul_device].id, "%d+"))
	local pinCode = validatePin(lul_settings.PINCode)
	if (pinCode == nil) then return 2, nil end

	local command = {
		Armed = "\002",
		Stay = "\003",
		Disarmed = "\001"
	}
	local commandByte = command[lul_settings.State]
	if (commandByte == nil) then
		-- Command not supported.
		return 2, nil
	end
	if (LOG_DEBUG) then luup.log("Job: Adding job") end
	addPendingJob(getJobId(lul_job),
		"\060" .. pinCode .. commandByte .. string.char(2 ^ (partition-1)),
		{
			[29] = function(deviceId, message)
				-- Nothing more to do.  The interface will
				-- send a snapshot with the updated info RSN,
				-- and we'll update the partition device then.
				return pendingJobDone(getJobId(lul_job), 4)
			end,
			[31] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end

-- jobRequestPanicMode(lul_device, lul_settings, lul_job)
-- Initiate a panic mode (fire, police, medical) if enabled.
function jobRequestPanicMode(lul_device, lul_settings, lul_job)
	if (LOG_DEBUG) then luup.log("Job: Partition: RequestMedicalPanic to " .. lul_settings.State .. " " .. lul_device .. " job " .. getJobId(lul_job)) end
	
	if (luup.variable_get(ALARM_SERVICEID, "EnablePanic", lul_device) ~= "1") then
		-- Panic disabled; return error.
		return 2, nil
	end
	if (not CAPABILITY_SECONDARY_KEYPAD) then
		-- Cannot send panic; return error.
		return 2, nil
	end
	local partition = tonumber(string.match(luup.devices[lul_device].id, "%d+"))

	local command = {
		Medical = "\005",
		Fire = "\004",
		Police = "\006"
	}
	local commandByte = command[lul_settings.State]
	if (commandByte == nil) then
		-- Command not supported.
		return 2, nil
	end
	if (LOG_DEBUG) then luup.log("Job: Adding job") end
	addPendingJob(getJobId(lul_job),
		"\062" .. commandByte .. string.char(2 ^ (partition-1)),
		{
			[29] = function(deviceId, message)
				-- Nothing more to do.  The interface will
				-- send a snapshot with the updated info RSN,
				-- and we'll update the partition device then.
				return pendingJobDone(getJobId(lul_job), 4)
			end,
			[31] = function(deviceId, message)
				return pendingJobDone(getJobId(lul_job), 2)
			end,
		}
	)
	if (LOG_DEBUG) then luup.log("Job: Processing send queue") end
	processSendQueue()
	if (LOG_DEBUG) then luup.log("Job: Started") end
	-- Either the timeout or incoming task will be called next.
	return 5, 10
end
