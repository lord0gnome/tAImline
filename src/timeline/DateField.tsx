import { type Component, Match, Switch } from "solid-js";
import type { Precision } from "~/lib/dates.ts";

interface Props {
  value: string; // canonical YYYY-MM-DD
  precision: Precision;
  required?: boolean;
  onChange: (value: string) => void;
}

// Renders the input that matches the chosen precision (year → number,
// month → month picker, day → date picker) while always emitting a canonical
// YYYY-MM-DD string so the rest of the app stays uniform.
const DateField: Component<Props> = (props) => {
  return (
    <Switch>
      <Match when={props.precision === "year"}>
        <input
          type="number"
          min="1"
          max="9999"
          required={props.required}
          value={props.value.slice(0, 4)}
          onInput={(e) => {
            const y = e.currentTarget.value;
            props.onChange(y ? `${y.padStart(4, "0")}-01-01` : "");
          }}
        />
      </Match>
      <Match when={props.precision === "month"}>
        <input
          type="month"
          required={props.required}
          value={props.value.slice(0, 7)}
          onInput={(e) => {
            const v = e.currentTarget.value;
            props.onChange(v ? `${v}-01` : "");
          }}
        />
      </Match>
      <Match when={props.precision === "day"}>
        <input
          type="date"
          required={props.required}
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Match>
    </Switch>
  );
};

export default DateField;
