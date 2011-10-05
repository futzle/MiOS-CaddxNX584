/**********
 *
 * Configuration tab
 *
 **********/

function configurationTab(device)
{
	var html = '';
	html += '<p id="caddx_saveChanges" style="display:none; font-weight: bold; text-align: center;">Close dialog and press SAVE to commit changes.</p>';

	// Configuration of panel.
	var alwaysConfigure = '';
	var debugEnabled = (get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Debug", 0) == "1");
	alwaysConfigure += '<tr title="Verbose debugging messages to Luup Log">';
	alwaysConfigure += '<td>Debug to Luup log</td>';
	alwaysConfigure += '<td><input type="checkbox" onclick="set_device_state(' + device + ', \'urn:futzle-com:serviceId:CaddxNX584Security1\', \'Debug\', $F(this) ? \'1\' : \'\', 0); $(\'caddx_saveChanges\').show()" ';
	if (debugEnabled) alwaysConfigure += 'checked="checked"';
	alwaysConfigure += '></input></td>';
	alwaysConfigure += '</tr>';

	html += '<div id="caddx_configuration">Getting configuration...</div>';
	set_panel_html(html);

	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_GetConfiguration",
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var configuration = response.responseText.evalJSON();
			if (configuration == undefined)
			{
				$('caddx_configuration').innerHTML = '<table width="100%"><tbody>' + alwaysConfigure + '</table>';
			}
			else
			{
				// Success.  Populate.
				var table ='<table width="100%"><tbody>';

				table += alwaysConfigure;

				table += '<tr>';
				table += '<td>PIN length*</td>';
				table += '<td>' + configuration["pinLength"] + '</td>';
				table += '</tr>';

				table += '<tr title="Request zone names from a keypad connected to the panel">';
				table += '<td>Zone name*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["zoneName"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Get event history from the panel">';
				table += '<td>Get log event*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["logEvent"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Set the panel\'s date and time from MiOS">';
				table += '<td>Set panel clock*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["setClock"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Use a master PIN to get users\' PINs and authorization">';
				table += '<td>Get user information*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["getUserInformationWithPin"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Use a master PIN to set users\' PINs">';
				table += '<td>Set user code*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				var setUserCodeWithPinEnabled = configuration["capability"]["setUserCodeWithPin"] == "true";
				if (setUserCodeWithPinEnabled) table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Use a master PIN to set users\' Authorization">';
				table += '<td>Set user authorization*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				var setUserAuthorizationWithPinEnabled = configuration["capability"]["setUserAuthorizationWithPin"] == "true";
				if (setUserAuthorizationWithPinEnabled) table += 'checked="checked"';
				table += '></input></td></tr>';

				if (setUserCodeWithPinEnabled || setUserAuthorizationWithPinEnabled)
				{
					var masterUserProtect = (get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "MasterUserProtect", 0) != "0");
					table += '<tr title="Prevent changing Master users\' PINs or authorizations">';
					table += '<td>Protect Master users</td>';
					table += '<td><input type="checkbox" onclick="set_device_state(' + device + ', \'urn:futzle-com:serviceId:CaddxNX584Security1\', \'MasterUserProtect\', $F(this) ? \'\' : \'0\', 0); $(\'caddx_saveChanges\').show()" ';
					if (masterUserProtect) table += 'checked="checked"';
					table += '></input></td>';
					table += '</tr>';
				}

				table += '<tr title="Arm and disarm the panel with a PIN">';
				table += '<td>Primary keypad function*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["primaryKeypadWithPin"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Allow Quick Arm without PIN">';
				table += '<td>Secondary keypad function*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				var secondaryKeypadEnabled = (configuration["capability"]["secondaryKeypad"] == "true");
				if (secondaryKeypadEnabled) table += 'checked="checked"';
				table += '></input></td></tr>';

				if (secondaryKeypadEnabled)
				{
					var panicEnabled = (get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "EnablePanic", 0) == "1");
					table += '<tr title="Allow Police, Medical and Fire panic">';
					table += '<td>Panic (Police, Medical, Fire)</td>';
					table += '<td><input type="checkbox" onclick="set_device_state(' + device + ', \'urn:futzle-com:serviceId:CaddxNX584Security1\', \'EnablePanic\', $F(this) ? \'1\' : \'\', 0); $(\'caddx_saveChanges\').show()" ';
					if (panicEnabled) table += 'checked="checked"';
					table += '></input></td>';
					table += '</tr>';
				}

				table += '<tr title="Set zones\' Arm/Bypass state">';
				table += '<td>Zone bypass*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["zoneBypass"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';
				
 				table += '</tbody></table>';

				table += '<p>* These settings must be changed through the panel interface.</p>';

				$('caddx_configuration').innerHTML = table;
			}
		}, 
		onFailure: function () {
			$('caddx_configuration').innerHTML = '<table width="100%"><tbody>' + alwaysConfigure + '</table>';
		}
	});
}

/**********
 *
 * Zones tab
 *
 **********/

var existingZone;

// Entry point for "Zones" tab.
function zoneTab(device)
{
	existingZone = new Array();
	
	var html = "";
	html += '<p id="caddx_saveChanges" style="display:none; font-weight: bold; text-align: center;">Close dialog and press SAVE to commit changes.</p>';
	html += '<div style="margin: 5px; padding: 5px; border: 1px grey solid;">';
	html += '<p style="font-weight: bold; text-align: center;">Existing zones</p>';
	html += '<table width="100%">';
	html += '<thead><th>Zone</th><th>Name</th><th>Room</th><th>Info</th><th>Type</th><th>Action</th></thead>';
	html += '<tbody>';

	// Populate table with existing known zones.
	var z;
	for (z = 1; z <= 128; z++)
	{
		var type = get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Type", 0);
		// Empty string is equivalent to deleted.
		if (type != undefined && type != "")
		{
			var checkZoneDevice;
			var zoneName;
			var zoneRoom;
			var zoneFound;
			// Find the zone in the device list (requires exhaustive search).
			for (checkZoneDevice in jsonp.ud.devices)
			{
				if (jsonp.ud.devices[checkZoneDevice].id_parent == device &&
				jsonp.ud.devices[checkZoneDevice].altid == "Zone-" + z)
				{
					zoneName = jsonp.ud.devices[checkZoneDevice].name;
					var zoneRoomId = jsonp.ud.devices[checkZoneDevice].room;
					if (zoneRoomId == "0")
					{
						// Room 0 is unassigned, would break get_room_by_id().
						zoneRoom = "Unassigned";
					}
					else
					{
						zoneRoom = jsonp.get_room_by_id(zoneRoomId).name;
					}
					zoneFound = true;
				}
			}
			if (!zoneFound) { continue; }
			html += '<tr>';
			html += '<td>' + z + '</td>';
			html += '<td>' + zoneName.escapeHTML() + '</td>';
			html += '<td>' + zoneRoom.escapeHTML() + '</td>';
			html += '<td id="caddx_zoneInfo' + z + '"></td>';
			// Find nicer names for the standard sensor types.
			if (type == "D_MotionSensor1.xml") { type = "Motion"; }
			if (type == "D_SmokeSensor1.xml") { type = "Smoke"; }
			if (type == "D_TempLeakSensor1.xml") { type = "TempLeak"; }
			if (type == "D_DoorSensor1.xml") { type = "Door"; }
			html += '<td>' + type.escapeHTML() + '</td>';
			html += '<td><input type="button" value="Delete" onclick="deleteExistingZone(' + z + ',this,' + device + ')"></input></td>';
			html += '</tr>';
			existingZone[z] = true;
		}
	}
	html += '</tbody>';
	html += '</table>';
	html += '</div>';

	// Scan button for scanning new zones.
	html += '<div style="margin: 5px; padding: 5px; border: 1px grey solid;">';
	html += '<p style="font-weight: bold; text-align: center;">Scan zones</p>';
	html += 'Maximum zone: <input type="text" id="caddx_maxZone" size="3"></input>';
	html += ' <input type="button" onclick="scanAllZones($F(\'caddx_maxZone\'), ' + device + ')" value="Scan"></input>';
	html += '<div id="zoneScanOutput"></div>';
	html += '</div>';

	// Let user add a zone manually.
	html += '<div style="margin: 5px; padding: 5px; border: 1px grey solid;">';
	html += '<p style="font-weight: bold; text-align: center;">Manually add zone</p>';
	html += '<table width="100%">';
	html += '<thead><th>Zone</th><th>Name</th><th>Type</th><th>Action</th></thead>';
	html += '<tbody>';
	html += '<tr>';
	html += '<td><input id="caddx_zone_manual" type="text" size="3"></input></td>';
	html += '<td><input id="caddx_zoneName_manual" type="text" size="17"></input></td>';
	html += '<td><select id="caddx_zoneType_manual">' +
		'<option value="D_MotionSensor1.xml" selected="selected" >Motion</option>' +
		'<option value="D_DoorSensor1.xml">Door</option>' +
		'<option value="D_SmokeSensor1.xml">Smoke</option>' +
		'<option value="D_TempLeakSensor1.xml">Temp Leak</option>' +
		'</select></td>';
	html += '<td><input type="button" value="Add" onclick="addManualZone(this,' + device + ')"></input></td>';
	html += '</tr>';
	html += '</tbody>';
	html += '</table>';
	html += '</div>';

	set_panel_html(html);

	var stagger = 0;  // Delay requests a bit to prevent overload of serial line.
	for (z = 1; z <= 128; z++)
	{
		infoCell = $("caddx_zoneInfo"+z);
		if (infoCell)
		{
			scanExistingZone.delay(0.5 * stagger++, z, infoCell, device);
		}
	}
}

function scanExistingZone(z, infoCell, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lu_action",
			serviceId: "urn:futzle-com:serviceId:CaddxNX584Security1",
			action: "ZoneScan",
			Zone: z,
			DeviceNum: device,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobId = response.responseText.evalJSON()["u:ZoneScanResponse"]["JobID"];
			if (jobId == undefined)
			{
			}
			else
			{
				waitForScanExistingZoneJob.delay(0.5, z, jobId, infoCell, device);
			}
		}, 
		onFailure: function () {
		}
	});
}

function waitForScanExistingZoneJob(z, jobId, infoCell, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "jobstatus",
			job: jobId,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobStatus = response.responseText.evalJSON()["status"];
			if (jobStatus == 1 || jobStatus == 5)
			{
				// Repeat.  Hopefully not so many times as to overflow the stack.
				waitForScanExistingZoneJob.delay(0.5, z, jobId, infoCell, device);
			}
			else if (jobStatus == 2)
			{
			}
			else if (jobStatus == 4)
			{
				// Success.  Now get the result of the scan.
				getScanExistingZoneResult(z, infoCell, device);
			}
		}, 
		onFailure: function () {
		}
	});
}

function getScanExistingZoneResult(z, infoCell, device)
{
	var partitionList;
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_ZoneScan",
			zone: z,
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var partitionList = response.responseText.evalJSON()["partitions"];
			if (partitionList == undefined)
			{
			}
			else
			{
				// Success.  Populate.
				var info = "";
				if (partitionList != "") info += "Partition " + partitionList;
				infoCell.innerHTML = info;
			}
		}, 
		onFailure: function () {
		}
	});
}

// When "Scan" button on "Zones" tab is clicked.
function scanAllZones(maxZone, device)
{
	if (maxZone == "") return;
	var resultDiv = $("zoneScanOutput");
	while (resultDiv.hasChildNodes()) { resultDiv.removeChild(resultDiv.firstChild); }
	var resultTable = resultDiv.appendChild(document.createElement("table"));
	resultTable.setAttribute("width", "100%");
	var resultThead = resultTable.appendChild(document.createElement("thead"));
	resultThead.innerHTML = "<th>Zone</th><th>Name</th><th>Info</th><th>Type</th><th>Action</th>";
	var resultTbody = resultTable.appendChild(document.createElement("tbody"));

	var z;
	var stagger = 0;  // Delay requests a bit to prevent overload of serial line.
	for (z = 1; z <= maxZone-0; z++)
	{
		if (existingZone[z]) continue;
		var row = resultTbody.insertRow(-1);
		row.innerHTML = '<td colspan="5">Scanning zone ' + z + '...</td>';
		// Request the zone information.
		scanZone.delay(0.5 * stagger++, z, row, device);
	}
}

function getScanZoneResult(z, row, device)
{
	var partitionList;
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_ZoneScan",
			zone: z,
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var partitionList = response.responseText.evalJSON()["partitions"];
			if (partitionList == undefined)
			{
				row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
			}
			else
			{
				// Success.  Populate.
				var info = "";
				if (partitionList != "") info += "Partition " + partitionList;
				while (row.hasChildNodes()) { row.removeChild(row.firstChild); }
				row.appendChild(document.createElement("td")).innerHTML = z;
				var name = row.appendChild(document.createElement("td"));
				name.innerHTML = "Scanning name...";
				row.appendChild(document.createElement("td")).innerHTML = info;
				var type = row.appendChild(document.createElement("td"));
				var action = row.appendChild(document.createElement("td"));
				// Now we want the zone name.  Which is another scan-wait-fetch cycle...
				scanZoneName.delay(0.5, z, name, type, action, device);
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
		}
	});
}

// Scan one zone to get its details.
// Asynchronous request, so if it succeeds, monitor for the result.
function scanZone(z, row, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lu_action",
			serviceId: "urn:futzle-com:serviceId:CaddxNX584Security1",
			action: "ZoneScan",
			Zone: z,
			DeviceNum: device,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobId = response.responseText.evalJSON()["u:ZoneScanResponse"]["JobID"];
			if (jobId == undefined)
			{
				row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
			}
			else
			{
				row.innerHTML = '<td colspan="5">Waiting for response (zone ' + z + ')...</td>';
				waitForScanZoneJob.delay(0.5, z, jobId, row, device);
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
		}
	});
}

// Scan Zone job, wait for the result.
function waitForScanZoneJob(z, jobId, row, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "jobstatus",
			job: jobId,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobStatus = response.responseText.evalJSON()["status"];
			if (jobStatus == 1 || jobStatus == 5)
			{
				// Repeat.  Hopefully not so many times as to overflow the stack.
				waitForScanZoneJob.delay(0.5, z, jobId, row, device);
			}
			else if (jobStatus == 2)
			{
				row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
			}
			else if (jobStatus == 4)
			{
				// Success.  Now get the result of the scan.
				row.innerHTML = '<td colspan="5">Getting properties (zone ' + z + ')...</td>';
				getScanZoneResult(z, row, device);
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
		}
	});
}

// Get the result of the zone scan.
function getScanZoneResult(z, row, device)
{
	var partitionList;
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_ZoneScan",
			zone: z,
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var partitionList = response.responseText.evalJSON()["partitions"];
			if (partitionList == undefined)
			{
				row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
			}
			else
			{
				// Success.  Populate.
				var info = "";
				if (partitionList != "") info += "Partition " + partitionList;
				while (row.hasChildNodes()) { row.removeChild(row.firstChild); }
				row.appendChild(document.createElement("td")).innerHTML = z;
				var name = row.appendChild(document.createElement("td"));
				name.innerHTML = "Scanning name...";
				row.appendChild(document.createElement("td")).innerHTML = info;
				var type = row.appendChild(document.createElement("td"));
				var action = row.appendChild(document.createElement("td"));
				// Now we want the zone name.  Which is another scan-wait-fetch cycle...
				scanZoneName.delay(0.5, z, name, type, action, device);
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="5">Scanning zone ' + z + ' failed</td>';
		}
	});
}

// Scan the name of one zone.
// Asynchronous, so if it succeeds, wait for the result.
function scanZoneName(z, name, type, action, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lu_action",
			serviceId: "urn:futzle-com:serviceId:CaddxNX584Security1",
			action: "ZoneNameScan",
			Zone: z,
			DeviceNum: device,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobId = response.responseText.evalJSON()["u:ZoneNameScanResponse"]["JobID"];
			if (jobId == undefined)
			{
				displayZoneScanButtons(z, "", name, type, action, device);
			}
			else
			{
				name.innerHTML = 'Waiting for response...';
				waitForScanZoneNameJob.delay(0.5, z, jobId, name, type, action, device);
			}
		}, 
		onFailure: function () {
			displayZoneScanButtons(z, "", name, type, action, device);
		}
	});
}

// Wait for a Zone Name scan to return.
function waitForScanZoneNameJob(z, jobId, name, type, action, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "jobstatus",
			job: jobId,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobStatus = response.responseText.evalJSON()["status"];
			if (jobStatus == 1 || jobStatus == 5)
			{
				// No response yet. Repeat.
				waitForScanZoneNameJob.delay(0.5, z, jobId, name, type, action, device);
			}
			else if (jobStatus == 2)
			{
				// Failed.  Fall back to displaying a default zone name.
				displayZoneScanButtons(z, "", name, type, action, device);
			}
			else if (jobStatus == 4)
			{
				// Success.  Fetch the result.
				name.innerHTML = 'Getting name...';
				getScanZoneNameResult(z, name, type, action, device);
			}
		}, 
		onFailure: function () {
			// Failed.  Fall back to displaying a default zone name.
			displayZoneScanButtons(z, "", name, type, action, device);
		}
	});
}

// Fetch the zone name after a successful request.
function getScanZoneNameResult(z, name, type, action, device)
{
	var partitionList;
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_ZoneNameScan",
			zone: z,
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var text = response.responseText.evalJSON()["name"];
			if (text == undefined)
			{
				// Failed.  Fall back to displaying a default zone name.
				displayZoneScanButtons(z, "", name, type, action, device);
			}
			else
			{
				// Success.  Populate.
				displayZoneScanButtons(z, text, name, type, action, device);
			}
		}, 
		onFailure: function () {
			// Failed.  Fall back to displaying a default zone name.
			displayZoneScanButtons(z, "", name, type, action, device);
		}
	});
}

// Put a text box on the row for the zone name,
// a drop-down list for the zone type,
// and a button for adding the zone.
function displayZoneScanButtons(z, text, name, type, action, device)
{
	if (text == "") text = "Zone " + z;
	name.innerHTML = '<input id="caddx_zoneName_' + z + '" type="text" size="17"></input>';
	$("caddx_zoneName_" + z).setValue(text);

	type.innerHTML = '<select id="caddx_zoneType_' + z + '">' +
		'<option value="D_MotionSensor1.xml" selected="selected" >Motion</option>' +
		'<option value="D_DoorSensor1.xml">Door</option>' +
		'<option value="D_SmokeSensor1.xml">Smoke</option>' +
		'<option value="D_TempLeakSensor1.xml">Temp Leak</option>' +
		'</select>';

	action.innerHTML = '<input type="button" onclick="addScannedZone(' + z + ',$(\'caddx_zoneName_' + z + '\'),$(\'caddx_zoneType_' + z + '\'),this,' + device + ')" value="Add"></input>';
}

// Add variables for a newly-scanned zone when the user clicks the "Add" button.
function addScannedZone(z, text, type, button, device)
{
	// Prevent user from adding a second time.
	text.disable();
	type.disable();
	button.disable();
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Name", $F(text), 0);
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Type", $F(type), 0);
	// Feedback.
	button.setValue("Added");
	$('caddx_saveChanges').show();
}

// Delete variables for an existing zone when the user clicks the "Delete" button.
function deleteExistingZone(z, button, device)
{
	button.disable();
	// Can't actually delete.  Closest is to set to empty string.
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Name", "", 0);
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Type", "", 0);
	button.setValue("Deleted");
	$('caddx_saveChanges').show();
}

// Add a zone manually.
function addManualZone(button, device)
{
	var z = $F("caddx_zone_manual");
	var name = $F("caddx_zoneName_manual");
	if (z > 0 && z <= 128 && !existingZone[z] && name != "")
	{
		button.disable();
		$("caddx_zone_manual").disable();
		$("caddx_zoneName_manual").disable();
		set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Name", name, 0);
		set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "Zone" + z + "Type", $F("caddx_zoneType_manual"), 0);
		$("caddx_zoneType_manual").disable();
		// Feedback.
		button.setValue("Added");
		$('caddx_saveChanges').show();
	}

}

/**********
 *
 * Users tab
 *
 **********/

var existingUser;

function usersTab(device)
{
	existingUser = new Array();
	
	var html = '';
	html += '<p id="caddx_saveChanges" style="display:none; font-weight: bold; text-align: center;">Close dialog and press SAVE to commit changes.</p>';

	// User list.
	html += '<div id="caddx_users">Getting configuration...</div>';
	set_panel_html(html);

	// Need to know whether panel interface allows fetching PIN and authorization.
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_GetConfiguration",
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var configuration = response.responseText.evalJSON();
			if (configuration == undefined)
			{
				usersTabWithConfiguration($('caddx_users'), false, false, false, undefined, device);
			}
			else
			{
				// Success.  Populate.
				usersTabWithConfiguration($('caddx_users'),
					configuration["capability"]["getUserInformationWithPin"] == "true",
					configuration["capability"]["setUserCodeWithPin"] == "true",
					configuration["capability"]["setUserAuthorizationWithPin"] == "true",
					configuration["pinLength"]-0,
					device
				);
			}
		}, 
		onFailure: function () {
			usersTabWithConfiguration($('caddx_users'), false, false, false, undefined, device);
		}
	});

}


function usersTabWithConfiguration(div, getUserInformationEnabled, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device)
{
	var table = '';

	// Existing users.
	table += '<div style="margin: 5px; padding: 5px; border: 1px grey solid;">';
	table += '<p style="font-weight: bold; text-align: center;">Existing users</p>';
	if (getUserInformationEnabled || setUserCodeEnabled || setUserAuthorizationEnabled)
	{
		table += '<p title="Master PIN is required to see and set existing PINs and authorizations">Master PIN: <input id="caddx_existingUsersMasterPin" type="text" size="' + pinLength + '"></input>';
		if (getUserInformationEnabled) table += ' <input type="button" value="Get info" onclick="scanAllExistingUsers(' + setUserCodeEnabled + ',' + setUserAuthorizationEnabled + ',' + pinLength + ',' + device + ')"></input>';
		table += '</p>';
	}
	table += '<table id="caddx_usertable" width="100%"><thead>';
	table += '<th>User</th>';
	table += '<th>Name</th>';
	if (getUserInformationEnabled || setUserCodeEnabled) table += '<th>PIN</th>';
	if (getUserInformationEnabled || setUserAuthorizationEnabled) table += '<th>Authorization</th>';
	table += '<th>Action</th>';
	table += '</thead><tbody>';

	var u;
	for (u = 1; u < 100; u++)  // Max user number? 10 on mine.
	{
		var username = get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "User" + u, 0);
		if (username != undefined && username != "")
		{
			table += '<tr class="caddx_user">';
			table += '<td class="caddx_usernum">' + u + '</td>';
			table += '<td><input size="17" type="text" class="caddx_username" onchange="nameUser(' + u + ',this,' + device + ')" value="' + username.escapeHTML() + '"></input></td>';
			if (u < 98) // Magical user numbers are up in this range, and don't have PINs or authorizations.
			{
				if (getUserInformationEnabled || setUserCodeEnabled)
				{
					table += '<td class="caddx_userpin">';
					table += '</td>';
				}
	
				if (getUserInformationEnabled || setUserAuthorizationEnabled)
				{
					table += '<td class="caddx_userauthorization">';
					table += '</td>';
				}
				table += '<td class="caddx_useraction"><input class="caddx_useraction_hide" type="button" value="Hide" onclick="hideExistingUser(' + u + ',this,' + device + ')"></input></td>';
			}
			table += '</tr>';
			existingUser[u] = true;
		}
	}

	table += '</tbody></table>';
	table += '</div>';

	// Scan button for scanning undiscovered users.
	if (getUserInformationEnabled)
	{
		table += '<div style="margin: 5px; padding: 5px; border: 1px grey solid;">';
		table += '<p style="font-weight: bold; text-align: center;">Scan users</p>';
		table += '<p>';
		table += 'Master PIN: <input id="caddx_newUsersMasterPin" type="text" size="' + pinLength + '"></input>';
		table += ' Maximum user: <input type="text" id="caddx_maxUser" size="3"></input>';
		table += ' <input type="button" onclick="scanNewUsers($F(\'caddx_maxUser\'),' + pinLength + ',' + device + ')" value="Scan"></input></p>';
		table += '<div id="userScanOutput"></div>';
		table += '</div>';
	}

	// Let user add a user manually.
	table += '<div style="margin: 5px; padding: 5px; border: 1px grey solid;">';
	table += '<p style="font-weight: bold; text-align: center;">Manually add user</p>';
	table += '<table width="100%">';
	table += '<thead><th>User</th><th>Name</th><th>Action</th></thead>';
	table += '<tbody>';
	table += '<tr>';
	table += '<td><input id="caddx_user_manual" type="text" size="3"></input></td>';
	table += '<td><input id="caddx_userName_manual" type="text" size="17"></input></td>';
	table += '<td><input type="button" value="Add" onclick="addManualUser(this,' + device + ')"></input></td>';
	table += '</tr>';
	table += '</tbody>';
	table += '</table>';
	table += '</div>';

	div.innerHTML = table;
}

function scanAllExistingUsers(setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device)
{
	var masterPin = $F('caddx_existingUsersMasterPin');
	if (masterPin.length != pinLength) return;

	var stagger = 0;  // Delay requests a bit to prevent overload of serial line.
	var userTable = $('caddx_usertable');
	var userList = userTable.select('.caddx_usernum');
	var userObjectIterator;
	for(userObjectIterator = 0; userObjectIterator < userList.length; userObjectIterator++)
	{
		var u = userList[userObjectIterator].firstChild.data;
		var pinCell = userList[userObjectIterator].parentNode.select('.caddx_userpin');
		var authorizationCell = userList[userObjectIterator].parentNode.select('.caddx_userauthorization');
		var actionCell = userList[userObjectIterator].parentNode.select('.caddx_useraction');
		if (u < 98)
			scanUser.delay(0.5 * stagger++, u, masterPin, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device);
	}
}

function scanNewUsers(maxUser, pinLength, device)
{
	if (maxUser == "") return;
	var masterPin = $F('caddx_newUsersMasterPin');
	if (masterPin.length != pinLength) return;

	var resultDiv = $("userScanOutput");
	while (resultDiv.hasChildNodes()) { resultDiv.removeChild(resultDiv.firstChild); }
	var resultTable = resultDiv.appendChild(document.createElement("table"));
	resultTable.setAttribute("width", "100%");
	var resultThead = resultTable.appendChild(document.createElement("thead"));
	resultThead.innerHTML = "<th>User</th><th>Name</th><th>PIN</th><th>Authorization</th><th>Action</th>";
	var resultTbody = resultTable.appendChild(document.createElement("tbody"));

	var u;
	var stagger = 0;  // Delay requests a bit to prevent overload of serial line.
	for (u = 1; u <= maxUser-0; u++)
	{
		if (existingUser[u]) continue;
		var row = resultTbody.insertRow(-1);
		var html = '';
		html += '<td>' + u + '</td>';
		html += '<td><input type="text" class="caddx_username" size="17" value="User ' + u + '"></td>';
		html += '<td class="caddx_userpin">Scanning...</td>';
		html += '<td class="caddx_userauthorization">Scanning...</td>';
		html += '<td><input type="button" Value="Add" onclick="addScannedUser(' + u + ',this,' + device + ')"></input></td>';
		row.innerHTML = html;
		// Request the user information.
		if (u < 98)
			scanUser.delay(0.5 * stagger++, u, masterPin, row.select(".caddx_userpin"), row.select(".caddx_userauthorization"), new Array(), false, false, pinLength, device);
	}
}

function scanUser(u, masterPin, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device)
{
	// if (pinCell.length > 0) pinCell[0].innerHTML = "Fetching...";
	// if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Fetching..."

	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lu_action",
			serviceId: "urn:futzle-com:serviceId:CaddxNX584Security1",
			action: "UserScan",
			User: u,
			MasterPIN: masterPin,
			DeviceNum: device,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobId = response.responseText.evalJSON()["u:UserScanResponse"]["JobID"];
			if (jobId == undefined)
			{
				if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
				if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
			}
			else
			{
				if (pinCell.length > 0) pinCell[0].innerHTML = "Waiting...";
				if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Waiting..."
				waitForScanUserJob.delay(0.5, u, jobId, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device);
			}
		}, 
		onFailure: function () {
			if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
			if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
		}
	});
}

function waitForScanUserJob(u, jobId, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "jobstatus",
			job: jobId,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobStatus = response.responseText.evalJSON()["status"];
			if (jobStatus == 1 || jobStatus == 5)
			{
				// Repeat.  Hopefully not so many times as to overflow the stack.
				waitForScanUserJob.delay(0.5, u, jobId, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device);
			}
			else if (jobStatus == 2)
			{
				if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
				if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
			}
			else if (jobStatus == 4)
			{
				if (pinCell.length > 0) pinCell[0].innerHTML = "Getting result";
				if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Getting result"
				getScanUserResult(u, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device);
			}
		}, 
		onFailure: function () {
			if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
			if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
		}
	});
}

function getScanUserResult(u, pinCell, authorizationCell, actionCell, setUserCodeEnabled, setUserAuthorizationEnabled, pinLength, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_UserScan",
			user: u,
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var userInfo = response.responseText.evalJSON();
			if (userInfo == undefined)
			{
				if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
				if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
			}
			else
			{
				// Success.  Populate.
				if (pinCell.length > 0)
				{
					var masterUserProtect = (get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "MasterUserProtect", 0) != "0");
					if ((!masterUserProtect || !(userInfo.authorization.master)) && setUserCodeEnabled)
					{
						pinCell[0].innerHTML = '<input type="text" size="' + pinLength + '" value="' + userInfo.pin.escapeHTML()+ '"></input>';
						if (actionCell[0].select('.caddx_useraction_setpin').length == 0)
						{
							// Add "Set PIN" button.
							var setPinButton = document.createElement('input');
							setPinButton.setAttribute('type', 'button');
							setPinButton.setAttribute('value', 'Set PIN');
							setPinButton.setAttribute('class', 'caddx_useraction_setpin');
							//setPinButton.setAttribute('onclick', 'TODO');
							actionCell[0].appendChild(document.createTextNode(' '));
							actionCell[0].appendChild(setPinButton);
						}
					}
					else
					{
						// Not allowed to edit the PIN.
						pinCell[0].innerHTML = userInfo.pin;
					}
				}
				if (authorizationCell.length > 0)
				{
					if (false && setUserAuthorizationEnabled)
					{
						// TO DO.
					}
					else
					{
						var html = '';
						if (userInfo.authorization.master == "true")
						{
							html += 'Master';
						}
						if (userInfo.authorization.arm == "all")
						{
							if (html != '') html += '; ';
							html += 'Arm';
						}
						if (userInfo.authorization.arm == "closing")
						{
							if (html != '') html += '; ';
							html += 'Arm (closing)';
						}
						if (userInfo.authorization.disarm == "true")
						{
							if (html != '') html += '; ';
							html += 'Disarm';
						}
						if (userInfo.authorization.bypass == "true")
						{
							if (html != '') html += '; ';
							html += 'Bypass';
						}
						if (userInfo.authorization.report == "true")
						{
							if (html != '') html += '; ';
							html += 'Report';
						}
						if (html != '') html = '<div>' + html + '</div>';
						if (userInfo.authorization.outputEnable)
						{
							html += '<div>Output ' + userinfo.authorization.outputEnable + '</div>';
						}
						if (userInfo.partitions)
						{
							html += '<div>Partition ' + userInfo.partitions + '</div>';
						}
						html += '';
						authorizationCell[0].innerHTML = html;
					}
				}
			}
		}, 
		onFailure: function () {
			if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
			if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
		}
	});
}

// Rename an existing user
function nameUser(u, text, device)
{
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "User" + u, $F(text), 0);
	$('caddx_saveChanges').show();
}

// Delete variables for an existing user when the user clicks the "Hide" button.
function hideExistingUser(u, button, device)
{
	// Grey out buttons.
	button.parentNode.parentNode.select('input').invoke('disable');
	// Can't actually delete.  Closest is to set to empty string.
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "User" + u, "", 0);
	button.setValue("Hidden");
	$('caddx_saveChanges').show();
}

// Add a user from a scan.
function addScannedUser(u, button, device)
{
	var nameInput = button.parentNode.parentNode.select('.caddx_username')[0];
	button.disable();
	nameInput.disable();
	set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "User" + u, $F(nameInput), 0);
	button.setValue("Added");
	$('caddx_saveChanges').show();
}

// Add a user manually.
function addManualUser(button, device)
{
	var u = $F("caddx_user_manual");
	var name = $F("caddx_userName_manual");
	if (u > 0 && u < 100 && !existingUser[u] && name != "")
	{
		button.disable();
		$("caddx_user_manual").disable();
		$("caddx_userName_manual").disable();
		set_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "User" + u, name, 0);
		// Feedback.
		button.setValue("Added");
		$('caddx_saveChanges').show();
	}

}

/**********
 *
 * Event Log tab
 *
 **********/

function eventLogTab(device)
{
	var topOfStack = get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "StackPointer", 1) - 0;
	var html = '';
	html += '<p>Log entries <input type="hidden" id="caddx_getMoreLogStart" value="' + topOfStack + '"></input><input id="caddx_getMoreLogCount" type="text" value="10" size="3"></input> <input id="caddx_getMoreLogButton" type="button" value="Get more" disabled="disabled" onclick="scanLogEvent($F(\'caddx_getMoreLogStart\'), $F(\'caddx_getMoreLogCount\'), $(\'caddx_logEventTable\'), ' + device + ')"></input></p>';
	html += '<table width="100%">';
	html += '<th>Date</th><th>Time</th><th>Event</th>';
	html += '<tbody id="caddx_logEventTable"></tbody>'
	html += '</table>';

	set_panel_html(html);

	scanLogEvent(topOfStack, $F('caddx_getMoreLogCount'), $('caddx_logEventTable'), device)
}

function scanLogEvent(sp, count, table, device)
{
	$('caddx_getMoreLogButton').disable();
	var row = table.insertRow(-1);
	row.innerHTML = '<td colspan="3">Getting event...</td>';
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lu_action",
			serviceId: "urn:futzle-com:serviceId:CaddxNX584Security1",
			action: "LogEventScan",
			StackPointer: sp,
			DeviceNum: device,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobId = response.responseText.evalJSON()["u:LogEventScanResponse"]["JobID"];
			if (jobId == undefined)
			{
				row.innerHTML = '<td colspan="3">Failed to get event</td>';
				$('caddx_getMoreLogButton').enable();
			}
			else
			{
				waitForScanLogEventJob.delay(0.5, sp, jobId, count, table, row, device);
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="3">Failed to get event</td>';
			$('caddx_getMoreLogButton').enable();
		}
	});
}

function waitForScanLogEventJob(sp, jobId, count, table, row, device)
{
	row.innerHTML = '<td colspan="3">Waiting for response...</td>';
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "jobstatus",
			job: jobId,
			output_format: "json"
		},
		onSuccess: function (response) {
			var jobStatus = response.responseText.evalJSON()["status"];
			if (jobStatus == 1 || jobStatus == 5)
			{
				// Repeat.  Hopefully not so many times as to overflow the stack.
				waitForScanLogEventJob.delay(0.5, sp, jobId, count, table, row, device);
			}
			else if (jobStatus == 2)
			{
				row.innerHTML = '<td colspan="3">Failed to get event</td>';
				$('caddx_getMoreLogButton').enable();
			}
			else if (jobStatus == 4)
			{
				// Success.  Now get the result of the scan.
				getScanLogEventResult(sp, count, table, row, device);
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="3">Failed to get event</td>';
			$('caddx_getMoreLogButton').enable();
		}
	});
}

function getScanLogEventResult(sp, count, table, row, device)
{
	row.innerHTML = '<td colspan="3">Getting response...</td>';
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_LogEventScan",
			stackpointer: sp,
			rand: Math.random(),
			output_format: "json"
		},
		onSuccess: function (response) {
			var log = response.responseText.evalJSON();
			var html = '';

			// Date.
			html += '<td>';
			html += log.timestamp.month;
			html += '-';
			html += log.timestamp.date;
			html += '</td>';

			// Time.
			html += '<td>';
			html += log.timestamp.hour;
			html += ':';
			if (log.timestamp.minute < 10) html += '0';
			html += log.timestamp.minute;
			html += '</td>';

			// Message.
			html += '<td>';
			html += log.messageText.escapeHTML();
			html += '</td>';

			row.innerHTML = html;

			// Next row of log.
			// Stack rolls around: 0 to max log size - 1.
			if (--sp < 0) sp = log.logSize - 1;
			$('caddx_getMoreLogStart').setValue(sp);
			if (count > 1)
			{
				// Do another row.
				scanLogEvent(sp, count-1, table, device)
			}
			else
			{
				// Enable "get more" button.
				$('caddx_getMoreLogButton').enable();
			}
		}, 
		onFailure: function () {
			row.innerHTML = '<td colspan="3">Failed to get event</td>';
			$('caddx_getMoreLogButton').enable();
		}
	});
}
