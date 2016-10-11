# StateMachine
Call State Machine with Synchronised DB Action
Makes use of a state machine library called Machina.js
* Redis as a Database store
* Connection to Asterisk Manager Interface to receive call events.
* Has a in-memory queue to store the call state sequence and to facilate synchronised DB action in the same order as the call events.
