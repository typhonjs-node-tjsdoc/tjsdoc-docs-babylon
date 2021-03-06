import ModuleVariableDocBase  from 'tjsdoc-docs-common/src/doc/base/ModuleVariableDocBase.js';

/**
 * Doc Class from Variable Declaration AST node.
 */
export default class ModuleVariableDoc extends ModuleVariableDocBase
{
   /** set name by using self node. */
   static _$name()
   {
      const type = this._node.declarations[0].id.type;

      switch (type)
      {
         case 'Identifier':
            this._value.name = this._node.declarations[0].id.name;
            break;

         case 'ObjectPattern':
            // TODO: optimize for multi variables.
            // e.g. export const {a, b} = obj
            this._value.name = this._node.declarations[0].id.properties[0].key.name;
            break;

         case 'ArrayPattern':
            // TODO: optimize for multi variables.
            // e.g. export cont [a, b] = arr
            this._value.name = this._node.declarations[0].id.elements.find((v) => v).name;
            break;

         default:
            throw new Error(`unknown declarations type: ${type}`);
      }
   }

   /**
    * if @type does not exist guess type by using self node.
    *
    * Note: For NewExpression this only works for directly exported nodes and not intermediate exports.
    * Intermediate nodes like `export default <variable>` or `export default new Class()` need special processing
    * in DocGenerator `_processDefaultExport` & `_processNamedExport` to set the type based on the intermediate export.
    */
   static _$type()
   {
      super._$type();

      if (this._value.type) { return; }

      if (this._node.declarations[0].init.type === 'NewExpression')
      {
         const className = this._node.declarations[0].init.callee.name;
         let longname = this._findClassLongname(className);

         if (!longname) { longname = '*'; }

         this._value.type = { types: [longname] };
      }
      else
      {
         this._value.type = this._eventbus.triggerSync('tjsdoc:system:parser:param:type:guess',
          this._node.declarations[0].init);
      }
   }
}
