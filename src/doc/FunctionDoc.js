import babelGenerator      from 'babel-generator';
import AbstractFunctionDoc from 'tjsdoc-docs-common/src/doc/abstract/AbstractFunctionDoc.js';

/**
 * Doc Class from Function declaration AST node.
 */
export default class FunctionDoc extends AbstractFunctionDoc
{
   /**
    * Assign async property from self node.
    */
   _$async()
   {
      this._value.async = this._node.async;
   }

   /** Assign generator property from self node */
   _$generator()
   {
      this._value.generator = this._node.generator;
   }

   /** Take out self name from self node */
   _$name()
   {
      if (this._node.id)
      {
         if (this._node.id.type === 'MemberExpression')
         {
            // e.g. foo[bar.baz] = function bal(){}
            const expression = babelGenerator(this._node.id).code;
            this._value.name = `[${expression}]`;
         }
         else
         {
            this._value.name = this._node.id.name;
         }
      }
      else
      {
         this._value.name = this._eventbus.triggerSync('tjsdoc:filepath:to:name', this._pathResolver.filePath);
      }
   }

   /** If @param does not exist then guess type of param by using self node. */
   _$param()
   {
      super._$param();

      if (this._value.params) { return; }

      this._value.params = this._eventbus.triggerSync('tjsdoc:guess:params', this._node.params);
   }

   /** If @return does not exist then guess type of return by using self node. */
   _$return()
   {
      super._$return();

      if (this._value.return) { return; }

      const result = this._eventbus.triggerSync('tjsdoc:guess:return:param', this._node.body);

      if (result)
      {
         this._value.return = result;
      }
   }
}
