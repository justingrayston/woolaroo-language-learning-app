import React from 'react';
import Chip from '@material-ui/core/Chip';
import DoneIcon from '@material-ui/icons/Done';
import './FilterChips.css';

class FilterChips extends React.Component {
  handleNeedsRecordingClick_(needsRecording) {
    this.props.updateNeedsRecording(needsRecording);
  }

  handleTop500Click_(top500) {
    this.props.updateTop500(top500);
  }

  render() {
    return (
      <div className="filter-chips">
        <Chip
          icon={this.props.top500 ? <DoneIcon /> : null}
          label="Top 500"
          clickable
          onClick={() => { this.handleTop500Click_(!this.props.top500) }}
          className="filter-chip top500-chip"
          color={this.props.top500 ? 'primary' : ''}
        />
        <Chip
          icon={this.props.needsRecording ? <DoneIcon /> : null}
          label="Needs Recording"
          clickable
          onClick={() => { this.handleNeedsRecordingClick_(!this.props.needsRecording) }}
          className="filter-chip recording-chip"
          color={this.props.needsRecording ? 'primary' : ''}
        />
      </div>
    );
  }
}

export default FilterChips;
