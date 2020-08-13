import { logInfo, logError } from './components/logger';
import defaultOptions from './components/options';
import parseData from './components/parser';
import fakeData from './components/fake';

/**
 * OverlayAPI class
 * @class
 */
export default class OverlayAPI {
  #options = {}; // Settings
  #subscribers = {}; // Data structure: { event: [cb] }
  #simulator = null; // Fake data interval

  #status = false; // Plugin init status
  #queue = []; // Data structure: [{ msg, cb }] (normal) | [msg] (ws)
  #wsURL = /[?&]OVERLAY_WS=([^&]+)/.exec(window.location.href); // Check if in WebSocket mode
  #ws = null; // WebSocket instance

  /**
   * Init API
   * @constructor
   * @param {Object} options Options
   */
  constructor(options = defaultOptions) {
    this.#options = options;

    if (this.#wsURL) {
      this.#initWebSocketMode();
    } else {
      this.#initCallbackMode();
    }

    // If in simulate mode
    if (this.#options.simulateData) {
      this.simulateData(true);
    }
  }

  /**
   * Init OverlayPluginApi connection
   * @private
   */
  #initCallbackMode() {
    if (!window.OverlayPluginApi || !window.OverlayPluginApi.ready) {
      setTimeout(this.#initCallbackMode, 300);
      return;
    }
    // API loaded
    this.#status = true;
    // Bind `this` for callback function called by OverlayAPI
    window.__OverlayCallback = this.#triggerEvents.bind(this);
    // Send all messages in queue to OverlayPlugin
    while (this.#queue.length > 0) {
      let { msg, cb } = this.#queue.shift();
      try {
        window.OverlayPluginApi.callHandler(JSON.stringify(msg), cb);
      } catch (e) {
        logError('Error stringify JSON', e, msg);
      }
    }
  }

  /**
   * Init WebSocket connection
   * @private
   */
  #initWebSocketMode() {
    this.#ws = new WebSocket(this.#wsURL[1]);
    // Log error
    this.#ws.addEventListener('error', (e) => {
      logError('WebSocket error', e);
    });
    // Successfully connected WebSocket
    this.#ws.addEventListener('open', () => {
      logInfo('WebSocket connected');
      this.#status = true;
      // Send all messages in queue to OverlayPlugin
      while (this.#queue.length > 0) {
        let msg = this.#queue.shift();
        this.#sendMessage(msg);
      }
    });
    // On message loaded from WebSocket
    this.#ws.addEventListener('message', (msg) => {
      try {
        msg = JSON.parse(msg.data);
      } catch (e) {
        logError('Error stringify JSON', e, msg);
        return;
      }
      this.#triggerEvents(msg);
    });
    // Connection failed
    this.#ws.addEventListener('close', () => {
      this.#status = false;
      logInfo('WebSocket trying to reconnect...');
      // Don't spam the server with retries
      setTimeout(() => {
        this.#initWebSocketMode();
      }, 300);
    });
  }

  /**
   * Trigger event function, called by OverlayPluginApi, need `this` binding
   * @private
   * @param {Object} msg Data from OverlayPluginApi
   */
  #triggerEvents(msg) {
    // If this event type has subscribers
    if (this.#subscribers[msg.type]) {
      // Trigger all event's callback
      for (let cb of this.#subscribers[msg.type]) {
        if (this.#options.liteMode) {
          cb(parseData(msg));
        } else {
          cb(msg);
        }
      }
    }
  }

  /**
   * Send message to OverlayPluginApi or push into queue before its init
   * @public
   * @param {Object} msg Object to send
   * @param {Function} cb Callback function
   */
  #sendMessage(msg, cb) {
    if (this.#wsURL) {
      if (this.#status) {
        try {
          this.#ws.send(JSON.stringify(msg));
        } catch (e) {
          logError('Error stringify JSON', e, msg);
          return;
        }
      } else {
        this.#queue.push(msg);
      }
    } else {
      if (this.#status) {
        try {
          window.OverlayPluginApi.callHandler(JSON.stringify(msg), cb);
        } catch (e) {
          logError('Error stringify JSON', e, msg);
          return;
        }
      } else {
        this.#queue.push({ msg, cb });
      }
    }
  }

  /**
   * Start listening event
   * @public
   * @param {String} event Event which to subscribe
   */
  #listenEvent(event) {
    this.#sendMessage({
      call: 'subscribe',
      events: [event],
    });
  }

  /**
   * Add an event listener
   * @public
   * @param {String} event Event to listen
   * @param {Function} cb Callback function
   */
  addListener(event, cb) {
    const eventListened = this.#subscribers.hasOwnProperty(event);
    // Init event array
    if (!eventListened) {
      this.#subscribers[event] = [];
    }
    // Push events
    if (typeof cb === 'function') {
      this.#subscribers[event].push(cb);
    } else {
      logError('Function addListener(event, cb) wrong params', cb);
      return;
    }
    // Listen event type
    if (!eventListened) {
      this.#listenEvent(event);
    }
  }

  /**
   * Remove a listener
   * @public
   * @param {String} event Event type which listener belongs to
   * @param {Function} cb Function which listener to remove
   */
  removeListener(event, cb) {
    const eventListened = this.#subscribers.hasOwnProperty(event);
    if (eventListened) {
      if (typeof cb === 'function') {
        let cbPos = this.#subscribers[event].indexOf(cb);
        if (cbPos >= 0) {
          this.#subscribers[event].splice(cbPos, 1);
        }
      } else {
        logError('Function removeListener(event, cb) wrong params', cb);
        return;
      }
    }
  }

  /**
   * Remove all listener of one event type
   * @public
   * @param {String} event Event type which listener belongs to
   */
  removeAllListener(event) {
    if (this.#subscribers[event] && this.#subscribers[event].length > 0) {
      this.#subscribers[event] = [];
    }
  }

  /**
   * Get all listeners of a event
   * @public
   * @param {String} event Event type which listener belongs to
   */
  listListener(event) {
    return this.#subscribers[event] ? this.#subscribers[event] : [];
  }

  /**
   * Ends current encounter and save it
   * Returns a Promise
   * @public
   */
  endEncounter() {
    if (this.#status) {
      return window.OverlayPluginApi.endEncounter();
    } else {
      return Promise.reject('[OverlayAPI] Plugin not ready yet');
    }
  }

  /**
   * Switch data simulation
   * @param {Boolean} status Simulate status
   */
  simulateData(status) {
    if (status) {
      this.#simulator = setInterval(() => {
        this.#triggerEvents(fakeData);
      }, 1000);
      logInfo('Data simulating on');
    } else {
      if (this.#simulator) {
        clearInterval(this.#simulator);
      }
      logInfo('Data simulating off');
    }
  }

  /**
   * This function allows you to call an overlay handler
   * These handlers are declared by Event Sources (either built into OverlayPlugin or loaded through addons like Cactbot)
   * Returns a Promise
   * @public
   * @param {Object} msg Message send to OverlayPlugin
   */
  call(msg) {
    return new Promise((resolve, reject) => {
      this.#sendMessage(msg, (data) => {
        let rd;
        try {
          rd = data == null ? null : JSON.parse(data);
        } catch (e) {
          logError('Error parse JSON', e, data);
          return reject(e);
        }
        return resolve(rd);
      });
    });
  }
}
