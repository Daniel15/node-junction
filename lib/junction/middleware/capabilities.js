/**
 * Module dependencies.
 */
var events = require('events')
  , util = require('util')
  , IQ = require('../elements/iq');

/**
 * Handle XMPP capabilities
 *
 * This middleware allows applications to handle XMPP capabilities.  Applications
 * provide a `callback(handler)` which the middleware calls with an instance of
 * `EventEmitter`.  Listeners can be attached to `handler` in order to process
 * presence stanza.
 *
 * Events:
 *   - `capabilities`   user's capabilities have been received. See capabilitiesParser.js
 *                      to see the data available in this event.
 *
 * Examples:
 *
 *      connection.use(junction.capabilitiesParser());
 *      connection.use(
 *        junction.capabilities(function(handler) {
 *          handler.on('capabilities', function(jid, caps) {
 *            console.log(jid, ' supports these: ', caps);
 *          });
 *        })
 *      );
 *
 * References:
 * - [XEP-0115: Entity Capabilities](http://xmpp.org/extensions/xep-0115.html)
 *
 * @param {Function} fn
 * @return {Function}
 * @api public
 */
module.exports = function capabilities(fn) {
  if (!fn) throw new Error('capabilities middleware requires a callback function');

  var handler = new Handler();
  fn.call(this, handler);

  return function capabilities(stanza, next) {
    if (stanza.is('presence')) {
      handler._handlePresence(stanza);
    } else if (stanza.is('iq')) {
      handler._handleIQ(stanza);
    }

    return next();
  }
}

/**
 * Initialize a new `Handler`.
 *
 * @api private
 */
function Handler() {
  events.EventEmitter.call(this);
  this._cache = {};
  this._pending = {};
};

/**
 * Inherit from `EventEmitter`.
 */
util.inherits(Handler, events.EventEmitter);

/**
 * Handle a presence stanza, if it include a capabilities node.
 *
 * @param {XMLElement} stanza
 * @api private
 */
Handler.prototype._handlePresence = function(stanza) {
  var c = stanza.getChild('c', 'http://jabber.org/protocol/caps');
  if (!c) { return; }

  var fullNode = c.attrs.node + '#' + c.attrs.ver;
  
  // Check if these capabilities are cached (that is, we already know what the verification string resolves to)
  if (this._cache[fullNode]) {
    this.emit('capabilities', stanza.from, this._cache[fullNode]);
    return;
  }

  // Not yet cached, so we need to retrieve the capabilities for this verification string
  // Save this person's JID in an array of pending requests, as we need to fire the event once the capabilities are
  // retrieved.
  if (!this._pending[fullNode]) {
    this._pending[fullNode] = [];
  }
  
  this._pending[fullNode].push(stanza.from);
  
  var getCaps = new IQ(stanza.from, 'get');
  // This always seems to require an ID even though we don't actually use it.
  getCaps.id = 'disco1';
  getCaps.c('query', { xmlns: 'http://jabber.org/protocol/disco#info', node: fullNode });
  stanza.connection.send(getCaps);
};

/**
 * Handle an IQ stanza, if it's a reply to a capability discovery query
 *
 * @param {XMLElement} stanza
 * @api private
 */
Handler.prototype._handleIQ = function(stanza) {
  var caps = stanza.capabilities,
    node = caps.node;
  
  this._cache[node] = caps;
  
  // Fire the event for all buddies that were waiting
  if (this._pending[node]) {
    var that = this;
    this._pending[node].forEach(function(jid) {
      that.emit('capabilities', jid, caps);  
    });
    delete this._pending[node];
  }
}
