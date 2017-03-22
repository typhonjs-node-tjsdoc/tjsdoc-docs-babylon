import * as Docs  from '../doc/';

/**
 * Provides a symbol to store checking if already covered.
 * @type {Symbol}
 * @ignore
 */
const s_ALREADY = Symbol('already');

/**
 * Test doc factory.
 *
 * @example
 * let factory = new TestDocFactory('mocha', ast, pathResolver, eventbus);
 * factory.push(node, parentNode);
 * let docData = factory.docData;
 */
export class TestDocFactory
{
   /**
    * create instance.
    *
    * @param {string}            type - Test type. For now only `mocha` is supported.
    *
    * @param {AST}               ast - AST of test code.
    *
    * @param {DocDB}             docDB - The target DocDB.
    *
    * @param {PathResolver}      pathResolver - Path resolver associated with test code.
    *
    * @param {EventProxy}        eventbus - An event proxy for the main eventbus.
    */
   constructor(type, ast, docDB, pathResolver, eventbus)
   {
      if (typeof type !== 'string') { throw new TypeError(`'type' is not a 'string'.`); }
      if (typeof ast !== 'object') { throw new TypeError(`'ast' is not an 'object'.`); }

      /**
       * Test type. For now only `mocha` is supported.
       * @type {string}
       */
      this._type = type;

      /**
       * AST of test code.
       * @type {AST}
       */
      this._ast = ast;

      /**
       * The target DocDB.
       * @type {DocDB}
       * @private
       */
      this._docDB = docDB;

      /**
       * Path resolver associated with test code.
       * @type {PathResolver}
       */
      this._pathResolver = pathResolver;

      /**
       * Stores the plugin eventbus proxy.
       * @type {EventProxy}
       */
      this._eventbus = eventbus;

      // Gets the current global / main plugin DocDB counter doc ID then increment it.
      const docID = eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get');

      /**
       * The associated ES file / module ID.
       * @type {number}
       */
      this._moduleID = docID;

      // Test file doc
      const doc = new Docs.TestFileDoc(docID, ast, ast, pathResolver, [], this._eventbus);

      // Insert test file doc.
      this._docDB.insertDocObject(doc);
   }

   /**
    * Gets a unique id.
    *
    * @returns {number} unique id.
    * @private
    */
   static _getUniqueId()
   {
      if (!this._sequence) { /** @type {number} */ this._sequence = 0; }

      return this._sequence++;
   }

   /**
    * push node, and factory process the node.
    *
    * @param {ASTNode} node - target node.
    * @param {ASTNode} parentNode - parent node of target node.
    */
   push(node, parentNode)
   {
      if (node[s_ALREADY]) { return; }

      node[s_ALREADY] = true;

      Reflect.defineProperty(node, 'parent', { value: parentNode });

      // In the future other testing frameworks may be supported, but only Mocha is presently.
      this._pushForMocha(node, parentNode);
   }

   /**
    * push node as mocha test code.
    * @param {ASTNode} node - target node.
    * @private
    */
   _pushForMocha(node)
   {
      if (node.type !== 'ExpressionStatement') { return; }

      const expression = node.expression;

      if (expression.type !== 'CallExpression') { return; }

      if (!['describe', 'it', 'context', 'suite', 'test'].includes(expression.callee.name)) { return; }

      expression[s_ALREADY] = true;

      Reflect.defineProperty(expression, 'parent', { value: node });

      let tags = [];

      if (node.leadingComments && node.leadingComments.length)
      {
         const comment = node.leadingComments[node.leadingComments.length - 1];

         tags = this._eventbus.triggerSync('tjsdoc:system:parser:comment:parse', comment);
      }

      const uniqueId = this.constructor._getUniqueId();

      expression._tjsdocTestId = uniqueId;
      expression._tjsdocTestName = expression.callee.name + uniqueId;

      const testDoc = new Docs.TestDoc(this._eventbus.triggerSync('tjsdoc:data:docdb:current:id:increment:get'),
       this._moduleID, this._ast, expression, this._pathResolver, tags, this._eventbus);

      // Insert test doc and destroy.
      this._docDB.insertDocObject(testDoc);
   }
}

/**
 * Wires up the event binding to create TestDocFactory instances for tests.
 *
 * @param {PluginEvent} ev - The plugin event.
 */
export function onPluginLoad(ev)
{
   const eventbus = ev.eventbus;

   eventbus.on('tjsdoc:system:doc:factory:test:create', ({ type, ast, docDB, filePath } = {}) =>
   {
      if (typeof type !== 'string')
      {
         throw new TypeError(`'tjsdoc:system:doc:factory:test:create' - 'type' is not a 'string'.`);
      }

      if (typeof ast !== 'object')
      {
         throw new TypeError(`'tjsdoc:system:doc:factory:test:create' - 'ast' is not an 'object'.`);
      }

      if (typeof filePath !== 'string')
      {
         throw new TypeError(`'tjsdoc:system:doc:factory:test:create' - 'filePath' is not a 'string'.`);
      }

      const pathResolver = eventbus.triggerSync('tjsdoc:system:path:resolver:create', filePath);

      if (typeof pathResolver !== 'object')
      {
         throw new TypeError(`'tjsdoc:system:doc:factory:test:create' - Could not create 'pathResolver'.`);
      }

      return new TestDocFactory(type, ast, docDB, pathResolver, eventbus);
   });
}
