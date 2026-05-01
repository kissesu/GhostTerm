// @file activity_cursor_test.go
// @description 测试 activity 游标 encode/decode 行为
// @author Atlas.oi
// @date 2026-05-01

package services

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncodeCursor_Roundtrip(t *testing.T) {
	c := activityCursor{
		At:       time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC),
		Kind:     "feedback",
		SourceID: 42,
	}
	encoded, err := encodeCursor(c)
	require.NoError(t, err)
	assert.NotEmpty(t, encoded)

	decoded, err := decodeCursor(encoded)
	require.NoError(t, err)
	assert.Equal(t, c.At.Unix(), decoded.At.Unix())
	assert.Equal(t, c.Kind, decoded.Kind)
	assert.Equal(t, c.SourceID, decoded.SourceID)
}

func TestDecodeCursor_Empty(t *testing.T) {
	c, err := decodeCursor("")
	require.NoError(t, err)
	assert.True(t, c.At.IsZero())
	assert.Empty(t, c.Kind)
	assert.Zero(t, c.SourceID)
}

func TestDecodeCursor_InvalidBase64(t *testing.T) {
	_, err := decodeCursor("not!valid!base64!!!")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidCursor))
}

func TestDecodeCursor_InvalidJSON(t *testing.T) {
	// base64("not json") = "bm90IGpzb24"
	_, err := decodeCursor("bm90IGpzb24")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidCursor))
}

func TestDecodeCursor_MissingFields(t *testing.T) {
	// base64("{}") = "e30"
	_, err := decodeCursor("e30")
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidCursor))
}
