import ModuleAssignmentDocBase   from 'tjsdoc-docs-common/src/doc/base/ModuleAssignmentDocBase.js';

/**
 * Doc Class for Assignment AST node.
 */
export default class ModuleAssignmentDoc extends ModuleAssignmentDocBase
{
   /**
    * Take out self name from self node.
    */
   static _$name()
   {
      this._value.name = this._eventbus.triggerSync('tjsdoc:system:ast:member:expression:flatten',
       this._node.left).replace(/^this\./, '');
   }
}

