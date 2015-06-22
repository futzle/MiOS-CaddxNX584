# MiOS-CaddxNX584

The NX series of alarm panels from (in various parts of the world) GE, Interlogix, Caddx, Networx, Hills or DAS Systems has a serial interface which lets you monitor partitions and zones, arm and disarm the system, and program the panel.

Some alarm panels (e.g., the NX-8E) have this serial interface built in. Other panels have no onboard serial interface and require the connection of the NX-584 expander, which contains only the serial interface. The protocol for the NX-8E and the NX-584 is the same.

This Luup plugin provides continuous monitoring of partitions and zones, reporting partitions' armed status and zones' tripped and bypass status, whether the system is armed or not. Additionally, if configured, the plugin can send Arm and Disarm events to the panel, allowing remote arming and disarming of partitions through scenes.

## Preparing the alarm system interface

The NX-584 must be programmed from a keypad connected to the alarm system.

Set the baud rate to match the setting on the other end of the serial cable. I use 38400, the default.

The interface must accept the following message types:

* Interface configuration message 01h
* Zone status message 04h
* Zones snapshot message 05h
* Partition status message 06h
* Partitions snapshot message 07h
* System status message 08h
* Interface configuration request 21h
* Zone status request 24h
* Zones snapshot request 25h
* Partition status request 26h
* Partitions snapshot request 27h
* System status request 28h 

Optional message types:

* Zone name message 03h and Zone name request 23h, if you have keypads that can display zone names and you want the plugin to fetch the names of the zones from the keypad.
* Set clock/calendar command 3Bh, if you want Vera to set the clock on the panel whenever the Luup plugin is started.
* Primary keypad function with PIN 3Ch, if you want Vera to be able to arm or disarm a partition with a PIN.
* Secondary keypad function 3Eh, if you want Vera to be able to run Quick Arm and Quick Stay.
* Zone bypass toggle 3Fh, if you want Vera to be able to arm or bypass zones.
* Log Message 0Ah, if you want to get system status information from the panel. 

(Todo: write instructions for this, referring to the NX-584 installation manual.) 

## Connecting Vera to the NX-584/NX-8E

Physically connecting the alarm panel to Vera varies depending on your own situation.

### NX-584 connection

The NX-584 has a male DB9 serial interface. To connect the interface to another computer, either:

* Use a female-to-female null modem cable, which swaps RX/TX and CTS/RTS to allow connection to a computer with a serial port, or
* Use a female-to-female gender changer, and adjust the jumpers on the NX-584/NX-8E board to make it swap RX and TX pins and RTS and CTS pins. 

The important thing to remember is that you have to cross over the RX and TX wires exactly once, and the CTS and RTS wires exactly once; this can be done either with a null modem cable or by swapping the jumpers on the NX-584 board.

### NX-8E connection

The NX-8E has a somewhat-standard 2x5-pin serial interface on the main board. The ​pinout is:

* NX-8E pin 3: RX (DB9 pin 2)
* NX-8E pin 5: TX (DB9 pin 3)
* NX-8E pin 9: Ground (DB9 pin 5)
* NX-8E pin 4: RTS (DB9 pin 7)
* NX-8E pin 6: CTS (DB9 pin 8)

In some parts of the world Caddx sells a cable with these connections. Third-party 10-pin serial cables might have the same pinout. Otherwise you can make one yourself.

You still need to cross over the RX/TX pair of wires and to cross over the RTS/CTS pair of wires exactly once; this can be done either with a null modem cable or by swapping the jumpers on the NX-8E board (does the NX-8E have jumpers?) or by wiring your DIY cable with the pairs swapped at one end.
Extending the serial line

The Vera and the Alarm panel might not be in the same room. You can add a female-to-male straight DB9 serial cable onto the end to make the serial connection as long as you like. Alternatively, if your alarm panel is close to an Ethernet connection, you can connect an IP-to-serial bridge (either a dedicated adapter like the ​WIZ110SR or a computer running ser2net).
Connecting Vera to the serial line

To connect the Vera directly, get a USB-to-serial adapter and plug it in.

Alternatively, if you have installed an IP-to-serial bridge, set up an IPSerial interface on Vera. 

## Install and set up the plugin

* Direct installation of files on your Vera on UI4 or UI5. Installation instructions for direct transfer.
* There is a version of this plugin modified by Micasaverde, appearing on the apps.mios.com portal. Installation instructions for apps.mios.com version. 

## Scan for zones

Zones are not detected automatically, so you must scan for the zones that your alarm system has. Click on the main alarm device's configuration icon (spanner/wrench), and go to the Zones tab. (It may be necessary to click the tab a second time.)

To scan for zones, enter the highest-numbered zone in your system into the Maximum zone text box, and click Scan. The plugin asks the alarm panel for all zones from 1 to the maximum, and (if it is supported and you have enabled it), each zone's name. Edit each zone's name and click Add. 

On the next Luup engine reload (press SAVE on the main window), the new zones will be created as child devices.

You can rename and relocate zones to other rooms. If you want to delete a zone, do this from the same Zones tab that you used to add zones.

