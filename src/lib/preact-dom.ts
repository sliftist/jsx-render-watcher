// Copied from https://github.com/developit/preact/blob/master/src/dom/index.js

export const IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|ows|mnc|ntw|ine[ch]|zoo|^ord/i;
/**
 * Set a named attribute on the given Node, with special behavior for some names
 * and event handlers. If `value` is `null`, the attribute/handler will be
 * removed.
 * @param {PreactElement} node An element to mutate
 * @param {string} name The name/key to set, such as an event or attribute name
 * @param {*} old The last value that was set for this name/node pair
 * @param {*} value An attribute value, such as a function to be used as an
 *  event handler
 * @param {boolean} isSvg Are we currently diffing inside an svg?
 * @private
 */
export function setAccessor(node: HTMLElement, name: string, old: any, value: any, isSvg: boolean) {
	if (name==='className') name = 'class';

	// https://stackoverflow.com/questions/38256332/in-react-whats-the-difference-between-onchange-and-oninput
	// React wires up onChange to onInput instead. So we really need to do the same, or else a lot of components will break,
	//	and anyone exclusively familiar with React will be confused (as I was), when their onChange wasn't being called until blur.
	if(name === "onChange") name = "onInput";
	if(name === 'value') {
		// Hmm... if it is a value, only set the node value. This doesn't set the attribute, so it doesn't show up in the
		//	html view... which is okay I guess? (it is what preact does at least...)
		(node as any).value = value;
	}
	else if (name==='key') {
		// ignore
	}
	else if (name==='ref') {
		if (old) old(null);
		if (value) value(node);
	}
	else if (name==='class' && !isSvg) {
		if(value) {
			node.className = value;
		} else {
			node.removeAttribute("class");
		}
	}
	else if (name==='style') {
		if (!value || typeof value==='string' || typeof old==='string') {
			node.style.cssText = value || '';
		}
		if (value && typeof value==='object') {
			if (typeof old!=='string') {
				for (let i in old) if (!(i in value)) (node.style as any)[i] = '';
			}
			for (let i in value) {
				(node.style as any)[i] = typeof value[i]==='number' && IS_NON_DIMENSIONAL.test(i)===false ? (value[i]+'px') : value[i];
			}
		}
	}
	else if (name==='dangerouslySetInnerHTML') {
		if (value) node.innerHTML = value.__html || '';
	}
	else if (name[0]=='o' && name[1]=='n') {
		let useCapture = name !== (name=name.replace(/Capture$/, ''));
		name = name.toLowerCase().substring(2);
		if (value) {
			if (!old) node.addEventListener(name, value, useCapture);
		}
		else {
			// TODO: Uh... we broke the remove here, so... maybe don't use this, because this will never remove a value...
			//	I think we need to use old for value?
			node.removeEventListener(name, value, useCapture);
		}
	}
	else if (name!=='list' && name!=='type' && !isSvg && name in node && name !== "value") {
		// Attempt to set a DOM property to the given value.
		// IE & FF throw for certain property-value combinations.
		try {
			(node as any)[name] = value==null ? '' : value;
		} catch (e) { }
		if ((value==null || value===false) && name!='spellcheck') node.removeAttribute(name);
	}
	else {
		let ns = isSvg && (name !== (name = name.replace(/^xlink:?/, '')));
		// spellcheck is treated differently than all other boolean values and
		// should not be removed when the value is `false`. See:
		// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#attr-spellcheck
		if (value==null || value===false) {
			if (ns) node.removeAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase());
			else node.removeAttribute(name);
		}
		else if (typeof value!=='function') {
			if (ns) node.setAttributeNS('http://www.w3.org/1999/xlink', name.toLowerCase(), value);
			else node.setAttribute(name, value);
		}
	}
}