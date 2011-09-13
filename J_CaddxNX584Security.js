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
	html += '<div id="caddx_configuration">Getting configuration...</div>';
	set_panel_html(html);

	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_GetConfiguration",
			output_format: "json"
		},
		onSuccess: function (response) {
			var configuration = response.responseText.evalJSON();
			if (configuration == undefined)
			{
				$('caddx_configuration').innerHTML = 'Failed to get configuration';
			}
			else
			{
				// Success.  Populate.
				var table ='<table width="100%"><tbody>';
				table += '<tr>';
				table += '<td>PIN length*</td>';
				table += '<td>' + configuration["pinLength"] + '</td>';
				table += '</tr>';

				table += '<tr title="Request zone names from a keypad connected to the panel">';
				table += '<td>Zone name*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["zoneName"] == "true") table += 'checked="checked"';
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
				if (configuration["capability"]["setUserCodeWithPin"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

				table += '<tr title="Use a master PIN to set users\' Authorization">';
				table += '<td>Set user authorization*</td>';
				table += '<td><input type="checkbox" disabled="disabled" ';
				if (configuration["capability"]["setUserAuthorizationWithPin"] == "true") table += 'checked="checked"';
				table += '></input></td></tr>';

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
			$('caddx_configuration').innerHTML = 'Failed to get configuration';
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
	html += '<thead><th>Zone</th><th>Name</th><th>Room</th><th>Type</th><th>Action</th></thead>';
	html += '<tbody>';

	// Populate table with existing known zones.
	var z;
	for (z = 1; z <= 48; z++)
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
	if (z > 0 && z <= 48 && !existingZone[z] && name != "")
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

function usersTab(device)
{
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
			output_format: "json"
		},
		onSuccess: function (response) {
			var configuration = response.responseText.evalJSON();
			if (configuration == undefined)
			{
				$('caddx_users').innerHTML = 'Failed to get configuration';
			}
			else
			{
				// Success.  Populate.
				var getUserInformationEnabled = (configuration["capability"]["getUserInformationWithPin"] == "true");
				var setUserCodeEnabled = (configuration["capability"]["setUserCodeWithPin"] == "true");
				var setUserAuthorizationEnabled = (configuration["capability"]["setUserAuthorizationWithPin"] == "true");

				var table = '';
				if (getUserInformationEnabled || setUserCodeEnabled || setUserAuthorizationEnabled)
				{
					table += '<p>Master PIN <input id="caddx_masterPin" type="text" size="' + (configuration["pinLength"] - -1) + '"></input>';
					if (getUserInformationEnabled) table += ' <input type="button" value="Get info" onclick="scanAllUsers(' + (configuration["pinLength"]-0) + ',' + device + ')"></input>';
					table += '</p>';
				}
				table +='<table id="caddx_usertable" width="100%"><thead>';
				table += '<th>User</th>';
				table += '<th>Name</th>';
				if (getUserInformationEnabled || setUserCodeEnabled) table += '<th>PIN</th>';
				if (getUserInformationEnabled || setUserAuthorizationEnabled) table += '<th>Authorization</th>';
				table += '<th>Action</th>';
				table += '</thead><tbody>';

				var u;
				for (u = 1; u < 10; u++)  // Max user number? 10 on mine.
				{
					var username = get_device_state(device, "urn:futzle-com:serviceId:CaddxNX584Security1", "User" + u, 0);
					if (username != undefined && username != "")
					{
						table += '<tr class="caddx_user">';
						table += '<td class="caddx_usernum">' + u + '</td>';
						table += '<td><input type="text" class="caddx_username" onchange="TODO" value="' + username.escapeHTML() + '"></input></td>';
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
						table += '<td><input type="button" value="Hide" onclick="TODO"></input></td>';

						table += '</tr>';
					}
				}

				table += '</tbody></table>';

				$('caddx_users').innerHTML = table;
			}
		}, 
		onFailure: function () {
			$('caddx_users').innerHTML = 'Failed to get configuration';
		}
	});

}

function scanAllUsers(pinLength, device)
{
	var pin = $F('caddx_masterPin');
	if (pin.length != pinLength) return;

	var stagger = 0;  // Delay requests a bit to prevent overload of serial line.
	var userTable = $('caddx_usertable');
	var userList = userTable.select('.caddx_usernum');
	var userObjectIterator;
	for(userObjectIterator = 0; userObjectIterator < userList.length; userObjectIterator++)
	{
		var u = userList[userObjectIterator].firstChild.data;
		var pinCell = userList[userObjectIterator].parentNode.select('.caddx_userpin');
		var authorizationCell = userList[userObjectIterator].parentNode.select('.caddx_userauthorization');
		scanUser.delay(0.5 * stagger++, u, pin, pinCell, authorizationCell, device)
	}
}

function scanUser(u, pin, pinCell, authorizationCell, device)
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
			MasterPIN: pin,
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
				waitForScanUserJob.delay(0.5, u, jobId, pinCell, authorizationCell, device);
			}
		}, 
		onFailure: function () {
			if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
			if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
		}
	});
}

function waitForScanUserJob(u, jobId, pinCell, authorizationCell, device)
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
				waitForScanUserJob.delay(0.5, u, jobId, pinCell, authorizationCell, device);
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
				getScanUserResult(u, pinCell, authorizationCell, device);
			}
		}, 
		onFailure: function () {
			if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
			if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
		}
	});
}

function getScanUserResult(u, pinCell, authorizationCell, device)
{
	new Ajax.Request("../port_3480/data_request", {
		method: "get",
		parameters: {
			id: "lr_UserScan",
			user: u,
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
					pinCell[0].innerHTML = userInfo.pin;
				}
				// TODO: finish.
			}
		}, 
		onFailure: function () {
			if (pinCell.length > 0) pinCell[0].innerHTML = "Failed";
			if (authorizationCell.length > 0) authorizationCell[0].innerHTML = "Failed"
		}
	});
}

