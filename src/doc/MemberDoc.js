import babelGenerator      from 'babel-generator';
import AbstractMemberDoc   from 'tjsdoc-docs-common/src/doc/abstract/AbstractMemberDoc.js';

import MethodDoc           from './MethodDoc.js';

/**
 * Doc Class from Member Expression AST node.
 */
export default class MemberDoc extends AbstractMemberDoc
{
   /** Borrow {@link MethodDoc#@_memberof} */
   _$memberof()
   {
      Reflect.apply(MethodDoc.prototype._$memberof, this, []);
   }

   /** Take out self name from self node */
   _$name()
   {
      let name;

      if (this._node.left.computed)
      {
         const expression = babelGenerator(this._node.left.property).code.replace(/^this/, '');
         name = `[${expression}]`;
      }
      else
      {
         name = this._eventbus.triggerSync('tjsdoc:system:ast:member:expression:flatten',
            this._node.left).replace(/^this\./, '');
      }
      this._value.name = name;
   }

   /** Assign static property */
   _$static()
   {
      let parent = this._node.parent;

      while (parent)
      {
         if (parent.type === 'ClassMethod')
         {
            this._value.static = parent.static;
            break;
         }
         parent = parent.parent;
      }
   }

   /** If @type does not exist then guess type by using self node */
   _$type()
   {
      super._$type();

      if (this._value.type) { return; }

      this._value.type = this._eventbus.triggerSync('tjsdoc:guess:type', this._node.right);
   }
}
