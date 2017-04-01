import babelGenerator      from 'babel-generator';
import ClassMemberDocBase  from 'tjsdoc-docs-common/src/doc/base/ClassMemberDocBase';

import ClassMethodDoc      from './ClassMethodDoc.js';

/**
 * Doc Class from Member Expression AST node.
 */
export default class ClassMemberDoc extends ClassMemberDocBase
{
   /** Borrow {@link MethodDoc#@_memberof} */
   static _$memberof()
   {
      Reflect.apply(ClassMethodDoc._$memberof, this, []);
   }

   /** Take out self name from self node */
   static _$name()
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
   static _$static()
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
   static _$type()
   {
      super._$type();

      if (this._value.type) { return; }

      this._value.type = this._eventbus.triggerSync('tjsdoc:system:parser:param:type:guess', this._node.right);
   }
}
